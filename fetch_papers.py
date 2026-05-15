import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import os
import re
import webbrowser
import time
import json
import subprocess

try:
    from deep_translator import GoogleTranslator
    HAS_TRANSLATOR = True
except ImportError:
    HAS_TRANSLATOR = False
    print("警告: deep-translator 未安装，将跳过翻译。请运行 pip install -r requirements.txt")

# ── 方向定义 ──────────────────────────────────────────────────────────────────

CATEGORIES = {
    "目标检测/分割": [
        # 检测
        "object detection", "detection", "yolo", "yolov", "faster rcnn",
        "fcos", "retinanet", "detr", "rt-detr", "co-detr", "dab-detr",
        "dn-detr", "anchor-free", "open-vocabulary detection",
        "open-set detection", "zero-shot detection", "few-shot detection",
        "small object", "dense prediction", "open world detection",
        "object counting", "crowd counting",
        # 分割
        "segmentation", "semantic segmentation", "instance segmentation",
        "panoptic segmentation", "segment anything", "sam", "sam2",
        "maskrcnn", "mask r-cnn", "open-vocabulary segmentation",
        "referring segmentation", "interactive segmentation",
        "weakly supervised segmentation", "semi-supervised segmentation",
        "video object segmentation", "vos",
        # 显著性与伪装
        "salient object detection", "saliency detection", "saliency",
        "camouflaged object", "camouflage detection",
        # 图像抠图
        "image matting", "alpha matting", "matting",
        # 视觉定位
        "visual grounding", "grounding", "referring expression",
        "phrase grounding", "region understanding",
        "grounding dino", "owl-vit",
        # 跟踪
        "object tracking", "multi-object tracking", "mot", "bytetrack",
        "visual tracking", "video object tracking", "single object tracking",
        "sot", "video instance",
    ],
    "多模态/VLM": [
        # 核心概念
        "multimodal", "vision-language", "vlm", "large vision model",
        "vision language model", "visual instruction",
        "large multimodal model", "lmm",
        # 主流模型
        "clip", "align", "florence", "blip", "llava", "instructblip",
        "minigpt", "qwen-vl", "internvl", "cogvlm", "phi-vision",
        "gpt-4v", "gpt-4o", "gemini", "internlm", "mplug",
        # 基础模型
        "foundation model", "large language model", "llm",
        "visual llm", "multimodal llm", "mllm",
        # 视频语言模型
        "video llm", "video language model", "video-language model",
        "video-language", "video understanding",
        # 音视频
        "audio-visual", "audio visual", "audio-language",
        "sound localization", "audio question answering",
        # 智能体
        "multimodal agent", "visual agent", "gui agent",
        "web agent", "screen understanding", "ui understanding",
        "vision-language-action", "vla",
        # 幻觉与对齐
        "visual hallucination", "hallucination", "alignment",
        "preference optimization", "dpo", "rlhf",
        # 任务
        "visual question answering", "vqa", "image captioning",
        "image-text matching", "cross-modal retrieval",
        "visual reasoning", "chart understanding", "document understanding",
        "scene text", "text recognition", "ocr",
        "visual commonsense", "visual entailment",
        # 视觉 Transformer
        "vision transformer", "vit", "swin transformer", "deit",
        "masked autoencoder", "mae",
    ],
    "生成模型/扩散": [
        # 扩散模型
        "diffusion model", "diffusion", "ddpm", "ddim", "score matching",
        "denoising diffusion", "stable diffusion", "latent diffusion",
        "classifier-free guidance", "cfg", "controlnet",
        "score distillation", "sds",
        # Flow / Consistency
        "flow matching", "rectified flow", "consistency model",
        "consistency distillation", "step distillation",
        # GAN
        "generative adversarial", "gan", "stylegan", "pix2pix",
        "cyclegan", "discriminator",
        # VAE / Tokenizer
        "variational autoencoder", "vae", "vq-vae", "codebook",
        "image tokenizer",
        # 个性化定制
        "personalization", "dreambooth", "textual inversion",
        "concept customization", "identity preservation", "lora",
        # 人脸生成与编辑
        "face generation", "face editing", "face swapping",
        "face reenactment", "talking head", "talking face",
        "portrait generation", "facial animation",
        # 虚拟试穿
        "virtual try-on", "try-on", "garment transfer",
        # 人体动作生成
        "motion generation", "human motion", "motion synthesis",
        "pose generation", "dance generation",
        # 数字人与Avatar
        "avatar", "digital human", "neural avatar",
        # 图像生成与编辑
        "text-to-image", "text to image", "image synthesis",
        "image generation", "image editing", "image inpainting",
        "image outpainting", "image-to-image", "style transfer",
        # 视频生成
        "video generation", "video synthesis", "video diffusion",
        "text-to-video", "image-to-video", "i2v",
        "video editing", "video prediction",
        # 图像恢复与增强
        "super-resolution", "super resolution", "image restoration",
        "image denoising", "image deblurring", "image enhancement",
        "low-light", "deraining", "dehazing", "derain",
    ],
    "3D视觉": [
        # NeRF 系列
        "nerf", "neural radiance field", "neural radiance",
        "instant ngp", "mip-nerf", "zipnerf", "tensorf",
        # Gaussian
        "3d gaussian", "gaussian splatting", "3dgs", "4d gaussian",
        "dynamic gaussian", "deformable gaussian",
        # 新视角合成
        "novel view synthesis", "view synthesis",
        "image-based rendering", "nvs",
        # 三维重建
        "3d reconstruction", "surface reconstruction",
        "structure from motion", "sfm", "multi-view stereo", "mvs",
        "dense reconstruction", "sparse reconstruction",
        "mesh reconstruction", "neural surface",
        "large reconstruction model", "lrm", "feed-forward reconstruction",
        # 动态场景
        "dynamic scene", "dynamic reconstruction", "4d reconstruction",
        "scene flow", "deformable scene",
        # 人体重建
        "human body reconstruction", "human mesh recovery",
        "smpl", "body model", "clothed human",
        "hand reconstruction", "hand mesh",
        # 光照与材质
        "relighting", "neural relighting", "material estimation",
        "brdf", "reflectance", "inverse rendering",
        # 深度估计
        "depth estimation", "monocular depth", "stereo depth",
        "depth completion", "metric depth", "depth prediction",
        # 点云
        "point cloud", "3d object detection", "3d segmentation",
        "pointnet", "point transformer", "voxel", "lidar",
        # 隐式表示
        "occupancy", "signed distance", "sdf", "neural implicit",
        "implicit representation",
        # 6D 位姿
        "6dof", "6d pose", "pose estimation", "object pose",
        "pose tracking", "hand pose",
        # 3D 生成
        "3d generation", "text-to-3d", "3d aware",
    ],
    "视频理解": [
        # 动作识别
        "action recognition", "activity recognition", "action detection",
        "temporal action", "action segmentation", "gesture recognition",
        # 视频理解
        "video understanding", "video recognition", "video classification",
        "spatiotemporal", "temporal modeling", "video representation",
        "long video", "long-form video", "video summarization",
        # 第一人称视角
        "egocentric", "first-person video", "ego4d",
        "exocentric", "ego-exo",
        # 视频检索与描述
        "video retrieval", "video-text retrieval",
        "dense video captioning", "video highlight detection",
        "video moment retrieval",
        # 光流与运动
        "optical flow", "motion estimation", "video stabilization",
        # 视频问答与描述
        "video question answering", "video captioning",
        "video description", "video grounding", "moment retrieval",
        "temporal grounding", "video-language",
        # 异常与人群
        "video anomaly", "anomaly detection",
        "crowd analysis", "pedestrian",
        # 人体行为
        "gait recognition", "skeleton", "body language",
        "sign language", "sign language recognition",
    ],
    "机器人视觉": [
        # 机器人操作
        "robot", "robotics", "manipulation", "grasping",
        "pick and place", "dexterous", "bimanual",
        "task and motion", "assembly",
        "contact-rich", "deformable", "cloth manipulation",
        "teleoperation", "imitation learning",
        # 腿足与人形机器人
        "humanoid", "locomotion", "quadruped", "legged robot",
        "legged locomotion", "bipedal", "whole-body control",
        "whole body control", "loco-manipulation",
        # 仿真到现实
        "sim-to-real", "sim2real", "reinforcement learning for robot",
        # 机器人基础模型
        "robot foundation model", "robot learning",
        "openvla", "rt-2", "octo", "diffusion policy",
        # 自动驾驶
        "autonomous driving", "self-driving", "autonomous vehicle",
        "bird's eye view", "bev", "lane detection", "traffic sign",
        "driving scene",
        # 导航与建图
        "navigation", "path planning", "visual navigation",
        "slam", "simultaneous localization", "localization",
        "visual odometry", "place recognition",
        # 具身智能
        "embodied", "embodied ai", "embodied agent",
        "embodied navigation", "vision-and-language navigation", "vln",
        "scene understanding",
    ],
    "医学图像": [
        # 成像模态
        "medical image", "medical imaging", "radiology", "radiograph",
        "ct scan", "mri", "ultrasound", "x-ray", "pet scan",
        "fundus", "retinal", "ophthalmology", "oct",
        "dermoscopy", "skin lesion", "dermatology",
        "endoscopy", "colonoscopy", "bronchoscopy",
        "microscopy", "fluorescence microscopy",
        # 解剖部位
        "cardiac", "heart segmentation", "echocardiography",
        "brain", "brain tumor", "brain segmentation",
        "spine", "vertebra", "spinal cord",
        "vessel", "vascular", "blood vessel",
        "lung", "liver", "kidney", "prostate",
        "fetal", "fetus",
        # 病理
        "pathology", "histology", "histopathology", "cytology",
        "whole slide image", "wsi",
        # 任务
        "tumor", "nodule", "lesion", "polyp", "cell segmentation",
        "tissue segmentation", "organ segmentation", "anatomy",
        "diagnosis", "surgical", "computer-aided diagnosis",
        "breast cancer", "lung cancer",
        # 医学 AI
        "medical report generation", "radiology report",
        "medical llm", "clinical llm", "medical foundation model",
        "medical vqa", "clinical decision",
    ],
    "遥感": [
        # 平台与传感器
        "remote sensing", "satellite", "aerial", "uav", "drone",
        "airborne", "sar", "synthetic aperture radar",
        "hyperspectral", "multispectral", "infrared", "thermal",
        # 图像处理
        "pansharpening", "pan-sharpening", "image fusion",
        "cloud removal", "cloud detection",
        # 应用
        "earth observation", "geospatial",
        "land cover", "land use", "change detection",
        "crop mapping", "urban", "building detection",
        "road extraction", "flood detection", "disaster",
        "vegetation", "deforestation",
        "ship detection", "vehicle detection",
        "wildfire", "fire detection",
        "glacier", "sea ice",
    ],
}

CATEGORY_COLORS = {
    "目标检测/分割": "#e74c3c",
    "多模态/VLM":   "#3498db",
    "生成模型/扩散": "#9b59b6",
    "3D视觉":       "#1abc9c",
    "视频理解":     "#e67e22",
    "机器人视觉":   "#27ae60",
    "医学图像":     "#e91e63",
    "遥感":         "#f39c12",
    "其他":         "#95a5a6",
}

# ── 抓取 ──────────────────────────────────────────────────────────────────────

ARXIV_QUERY      = "(cat:cs.CV OR cat:eess.IV OR cat:cs.RO OR cat:cs.GR)"
RSS_CATEGORIES   = ["cs.CV", "eess.IV", "cs.RO", "cs.GR"]


def _decode_html(text):
    return (text
            .replace("&lt;", "<").replace("&gt;", ">")
            .replace("&amp;", "&").replace("&quot;", '"')
            .replace("&apos;", "'").replace("&#39;", "'")
            .replace("&nbsp;", " "))


def _parse_rss_xml(xml_text):
    """解析 arxiv RSS (RDF 格式) → paper dict 列表。"""
    papers = []
    items  = re.findall(r'<item\b[^>]*>(.*?)</item>', xml_text, re.DOTALL)

    for raw in items:
        # 只要新投稿和跨类 (cross)，跳过 replace
        ann = re.search(r'<arxiv:announce_type[^>]*>\s*(.*?)\s*</arxiv:announce_type>',
                        raw, re.DOTALL)
        if ann and ann.group(1).strip() not in ("new", "cross"):
            continue

        # link
        m = re.search(r'<link[^>]+rdf:resource="(https://arxiv\.org/abs/[^"]+)"', raw)
        if not m:
            m = re.search(r'<link>(https://arxiv\.org/abs/[^<]+)</link>', raw)
        if not m:
            continue
        arxiv_link = m.group(1).strip()
        arxiv_id   = arxiv_link.split("/abs/")[-1]
        pdf_link   = f"https://arxiv.org/pdf/{arxiv_id}"

        # title —— 去掉末尾 "(arXiv:XXXX.XXXXX [cat])"
        title = ""
        m = re.search(r'<title>(.*?)</title>', raw, re.DOTALL)
        if m:
            title = re.sub(r'\s*\(arXiv:[^)]+\)\s*$', '',
                           _decode_html(m.group(1))).strip()

        # abstract —— description 字段，可能含 CDATA 和 HTML 标签
        abstract = ""
        m = re.search(r'<description>(.*?)</description>', raw, re.DOTALL)
        if m:
            desc  = m.group(1)
            cdata = re.search(r'<!\[CDATA\[(.*?)\]\]>', desc, re.DOTALL)
            desc  = cdata.group(1) if cdata else desc
            desc  = re.sub(r'<[^>]+>', ' ', desc)
            abstract = re.sub(r'\s+', ' ', _decode_html(desc)).strip()

        # authors
        authors = []
        m = re.search(r'<dc:creator>(.*?)</dc:creator>', raw, re.DOTALL)
        if m:
            authors = [a.strip() for a in _decode_html(m.group(1)).split(",")
                       if a.strip()][:5]

        # date
        pub_date = datetime.now().strftime("%Y-%m-%d")
        m = re.search(r'<prism:publicationDate>(.*?)</prism:publicationDate>', raw)
        if m:
            pub_date = m.group(1).strip()[:10]

        # github
        github_links = re.findall(r'https?://github\.com/[^\s\)\]"\'<>]+', abstract)
        github_link  = github_links[0].rstrip(".,;") if github_links else ""

        # categorise
        text_lower = (title + " " + abstract).lower()
        cats = [c for c, kws in CATEGORIES.items()
                if any(kw in text_lower for kw in kws)]
        if not cats:
            cats = ["其他"]

        papers.append({
            "title": title,       "title_zh": "",
            "abstract": abstract, "abstract_zh": "",
            "authors": authors,
            "arxiv_link": arxiv_link, "pdf_link": pdf_link,
            "pub_date": pub_date,
            "github_link": github_link,
            "categories": cats,
        })

    return papers


def fetch_today_listing():
    """
    主力抓取：从 arxiv 每日列表页获取今日全部论文 ID（含跨类），
    再批量从 export API 拉取完整元数据。
    可获取每个类别当天公告的所有论文，不受 RSS 100 条上限制约。
    """
    all_ids = []
    seen    = set()

    print("正在从 arxiv 列表页获取今日全部论文 ID...")
    for cat in RSS_CATEGORIES:
        url = f"https://arxiv.org/list/{cat}/new"
        try:
            resp = requests.get(url, timeout=30,
                                headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            html = resp.text

            # 只取 New submissions + Cross submissions，截掉 Replacement submissions 之后
            repl_pos = html.lower().find('replacement submissions')
            if repl_pos > 0:
                html = html[:repl_pos]

            # arxiv 列表页 href 格式：href ="/abs/..." （注意等号前有空格）
            ids = re.findall(r'href\s*=\s*"/abs/(\d{4}\.\d{4,5})', html)
            added = 0
            for aid in ids:
                if aid not in seen:
                    seen.add(aid)
                    all_ids.append(aid)
                    added += 1
            print(f"  {cat}: {added} 篇")
        except Exception as e:
            print(f"  {cat} 列表页失败: {e}")

    if not all_ids:
        return []

    # 批量拉取元数据（每批 150 篇，arxiv API 限速友好）
    print(f"共 {len(all_ids)} 篇，正在批量获取元数据...")
    papers     = []
    batch_size = 150
    for i in range(0, len(all_ids), batch_size):
        batch = all_ids[i : i + batch_size]
        try:
            resp = requests.get(
                "https://export.arxiv.org/api/query",
                params={"id_list": ",".join(batch), "max_results": len(batch)},
                timeout=90,
            )
            resp.raise_for_status()
            papers.extend(parse_papers(resp.text))
            print(f"  元数据 {min(i + batch_size, len(all_ids))}/{len(all_ids)}")
            time.sleep(1)
        except Exception as e:
            print(f"  批次 {i // batch_size + 1} 失败: {e}")

    return papers


def fetch_papers_rss():
    """备用：从 RSS 获取今日新论文（每类限 ~100 条）。"""
    all_papers = []
    seen_links = set()

    print("正在从 arxiv RSS 获取今日新论文（备用）...")
    for cat in RSS_CATEGORIES:
        url = f"https://arxiv.org/rss/{cat}"
        try:
            resp = requests.get(url, timeout=30,
                                headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            papers = _parse_rss_xml(resp.text)
            added  = 0
            for p in papers:
                if p["arxiv_link"] not in seen_links:
                    seen_links.add(p["arxiv_link"])
                    all_papers.append(p)
                    added += 1
            print(f"  {cat}: {added} 篇")
        except Exception as e:
            print(f"  {cat} RSS 失败: {e}")

    return all_papers


def fetch_papers(max_results=300):
    """备用：通过 export API 按提交日期降序抓取（有数小时延迟）。"""
    url = "https://export.arxiv.org/api/query"
    params = {
        "search_query": ARXIV_QUERY,
        "sortBy":       "submittedDate",
        "sortOrder":    "descending",
        "max_results":  max_results,
        "start":        0,
    }
    print(f"正在从 arxiv API 抓取最新论文（最多 {max_results} 篇）...")
    try:
        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as e:
        print(f"抓取失败: {e}")
        return None

# ── 解析 ──────────────────────────────────────────────────────────────────────

def parse_papers(xml_text):
    ns = {
        "atom":   "http://www.w3.org/2005/Atom",
        "arxiv":  "http://arxiv.org/schemas/atom",
    }
    root = ET.fromstring(xml_text)
    entries = root.findall("atom:entry", ns)
    print(f"解析到 {len(entries)} 篇论文...")

    papers = []
    for entry in entries:
        def txt(tag):
            el = entry.find(tag, ns)
            return el.text.strip().replace("\n", " ") if el is not None and el.text else ""

        title    = txt("atom:title")
        abstract = txt("atom:summary")

        authors = [
            a.find("atom:name", ns).text
            for a in entry.findall("atom:author", ns)
            if a.find("atom:name", ns) is not None
        ][:5]

        arxiv_link = pdf_link = ""
        for link in entry.findall("atom:link", ns):
            href = link.get("href", "")
            if link.get("rel") == "alternate":
                arxiv_link = href
            elif link.get("type") == "application/pdf":
                pdf_link = href

        if not arxiv_link:
            id_el = entry.find("atom:id", ns)
            if id_el is not None:
                aid = id_el.text.split("/")[-1]
                arxiv_link = f"https://arxiv.org/abs/{aid}"
                pdf_link   = f"https://arxiv.org/pdf/{aid}"

        pub_el   = entry.find("atom:published", ns)
        pub_date = pub_el.text[:10] if pub_el is not None and pub_el.text else ""

        github_links = re.findall(r"https?://github\.com/[^\s\)\]\"'>]+", abstract)
        github_link  = github_links[0].rstrip(".,;") if github_links else ""

        text_lower = (title + " " + abstract).lower()
        cats = [
            cat for cat, kws in CATEGORIES.items()
            if any(kw in text_lower for kw in kws)
        ]
        if not cats:
            cats = ["其他"]

        papers.append({
            "title":       title,
            "title_zh":    "",
            "abstract":    abstract,
            "abstract_zh": "",
            "authors":     authors,
            "arxiv_link":  arxiv_link,
            "pdf_link":    pdf_link,
            "pub_date":    pub_date,
            "github_link": github_link,
            "categories":  cats,
        })

    return papers

# ── 翻译 ──────────────────────────────────────────────────────────────────────

def _translate_one(translator, text, retries=3):
    text = text[:4900] if len(text) > 4900 else text
    for attempt in range(retries):
        try:
            result = translator.translate(text)
            return result if result else text
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.5)
    return text


def translate_papers(papers, batch_size=10, delay=0.8):
    if not HAS_TRANSLATOR:
        return papers

    translator = GoogleTranslator(source="en", target="zh-CN")
    total = len(papers)

    print(f"开始翻译 {total} 篇论文标题...")
    for i in range(0, total, batch_size):
        batch = papers[i : i + batch_size]
        for p in batch:
            p["title_zh"] = _translate_one(translator, p["title"])
        print(f"  标题 {min(i + batch_size, total)}/{total}")
        time.sleep(delay)

    print(f"开始翻译 {total} 篇论文摘要（较慢，请耐心等待）...")
    for i in range(0, total, batch_size):
        batch = papers[i : i + batch_size]
        for p in batch:
            p["abstract_zh"] = _translate_one(translator, p["abstract"])
        print(f"  摘要 {min(i + batch_size, total)}/{total}")
        time.sleep(delay)

    return papers

# ── 生成 HTML ─────────────────────────────────────────────────────────────────

def _escape(s):
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
             .replace('"', "&quot;"))


def generate_html(papers, base_dir):
    today         = datetime.now().strftime("%Y%m%d")
    month_folder  = datetime.now().strftime("%Y-%m")
    today_display = datetime.now().strftime("%Y年%m月%d日")

    cat_counts = {}
    for p in papers:
        for c in p["categories"]:
            cat_counts[c] = cat_counts.get(c, 0) + 1

    # ── 统计栏 ──
    all_cats = list(CATEGORIES.keys()) + ["其他"]
    stats_html = "".join(
        f'<div class="stat-item">'
        f'<span class="stat-dot" style="background:{CATEGORY_COLORS.get(c,"#95a5a6")}"></span>'
        f'{c}: {cat_counts.get(c,0)}篇</div>'
        for c in all_cats if cat_counts.get(c, 0)
    )

    # ── 筛选按钮 ──
    filter_btns = f'<button class="filter-btn active" onclick="filterBy(\'all\',this)">全部 ({len(papers)})</button>\n'
    for c in all_cats:
        if cat_counts.get(c, 0):
            col = CATEGORY_COLORS.get(c, "#95a5a6")
            filter_btns += (
                f'<button class="filter-btn" onclick="filterBy(\'{c}\',this)" '
                f'style="--cc:{col}">{c} ({cat_counts[c]})</button>\n'
            )

    # ── 论文卡片 ──
    cards = []
    for p in papers:
        cats      = p["categories"]
        primary   = cats[0]
        color     = CATEGORY_COLORS.get(primary, "#95a5a6")
        cats_attr = "|".join(cats)

        tags = "".join(
            f'<span class="tag" style="background:{CATEGORY_COLORS.get(c,"#95a5a6")}">{c}</span>'
            for c in cats
        )

        authors_str = "、".join(p["authors"])
        if len(p["authors"]) >= 5:
            authors_str += " 等"

        github_html = (
            f'<a href="{_escape(p["github_link"])}" target="_blank" class="github-link">⭐ GitHub 开源</a>'
            if p["github_link"]
            else '<span class="no-github">暂无开源</span>'
        )

        title_safe       = _escape(p["title"])
        title_zh_safe    = _escape(p["title_zh"] or p["title"])
        abstract_safe    = _escape(p["abstract"])
        abstract_zh_safe = _escape(p["abstract_zh"] or p["abstract"])
        authors_safe     = _escape(authors_str)
        arxiv_id         = p["arxiv_link"].split("/abs/")[-1]
        ar5iv_url        = f"https://ar5iv.labs.arxiv.org/html/{arxiv_id}"

        cards.append(f"""
<div class="card" data-cats="{cats_attr}" style="border-left:4px solid {color}">
  <div class="card-head">
    <div class="tags">{tags}</div>
    <span class="pub-date">{p["pub_date"]}</span>
  </div>
  <h3 class="title-en"><a href="{p["arxiv_link"]}" target="_blank">{title_safe}</a></h3>
  <p  class="title-zh">{title_zh_safe}</p>
  <p  class="authors">{authors_safe}</p>
  <div class="actions">
    <a href="{p["arxiv_link"]}" target="_blank" class="btn btn-abs">论文页面</a>
    <a href="{p["pdf_link"]}"   target="_blank" class="btn btn-pdf">PDF</a>
    <a href="{ar5iv_url}"       target="_blank" class="btn btn-html">HTML 版本</a>
    {github_html}
  </div>
  <div class="abs-wrap">
    <button class="toggle" onclick="toggle(this)">展开摘要 ▾</button>
    <div class="abs-body" hidden>
      <p class="abs-en">{abstract_safe}</p>
      <p class="abs-zh">{abstract_zh_safe}</p>
    </div>
  </div>
</div>""")

    cards_html = "\n".join(cards)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>arxiv CV 日报 · {today_display}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a3a6e;color:#eef6ff;font-size:15px;min-height:100vh}}
#bg{{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}}
.back-bar,.hd,.stats,.ctrl,.main{{position:relative;z-index:1}}

/* ── 顶栏 ── */
.back-bar{{background:rgba(255,255,255,.10);padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.18);backdrop-filter:blur(16px)}}
.back-btn{{display:inline-flex;align-items:center;gap:6px;color:#7dd8ff;font-size:14px;font-weight:600;text-decoration:none;padding:6px 14px;border-radius:8px;background:rgba(255,255,255,.10);border:1px solid rgba(120,200,255,.40);transition:all .2s}}
.back-btn:hover{{background:rgba(255,255,255,.18);box-shadow:0 0 16px rgba(56,182,255,.35)}}

/* ── 页头 ── */
.hd{{background:rgba(255,255,255,.10);backdrop-filter:blur(24px);color:#fff;padding:30px 20px 22px;text-align:center;border-bottom:1px solid rgba(255,255,255,.18);box-shadow:0 4px 32px rgba(0,0,0,.20)}}
.hd-title{{font-size:27px;font-weight:800;letter-spacing:4px;background:linear-gradient(90deg,#38b6ff 0%,#a78bfa 45%,#34d399 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 14px rgba(56,182,255,.5))}}
.hd .sub{{margin-top:7px;color:rgba(255,255,255,.70);font-size:13px;letter-spacing:1.5px}}
.hd .tot{{margin-top:9px;font-size:22px;font-weight:700;color:#7dd8ff;text-shadow:0 0 20px rgba(56,182,255,.5)}}
.author{{margin-top:10px;font-size:12px;color:rgba(255,255,255,.45);letter-spacing:1.5px;font-style:italic}}

/* ── 统计栏 ── */
.stats{{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;padding:11px 16px;background:rgba(0,20,60,.35);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.12)}}
.stat-item{{display:flex;align-items:center;gap:6px;font-size:12px;color:#cce8ff;text-shadow:0 1px 3px rgba(0,0,0,.4)}}
.stat-dot{{width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 6px currentColor}}

/* ── 搜索/筛选栏 ── */
.ctrl{{background:rgba(0,20,60,.40);backdrop-filter:blur(24px);padding:11px 16px;border-bottom:1px solid rgba(255,255,255,.14);position:sticky;top:0;z-index:99;box-shadow:0 4px 24px rgba(0,0,0,.18)}}
.search{{width:100%;padding:10px 20px;border:1px solid rgba(255,255,255,.30);border-radius:24px;font-size:15px;outline:none;background:rgba(255,255,255,.10);color:#eef6ff;transition:all .25s}}
.search::placeholder{{color:rgba(255,255,255,.45)}}
.search:focus{{border-color:rgba(120,210,255,.80);background:rgba(255,255,255,.16);box-shadow:0 0 20px rgba(56,182,255,.25)}}
.filters{{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}}
.filter-btn{{padding:6px 14px;border:1px solid rgba(255,255,255,.30);border-radius:18px;background:rgba(0,20,55,.35);cursor:pointer;font-size:12px;color:#cce8ff;transition:all .2s;touch-action:manipulation;text-shadow:0 1px 2px rgba(0,0,0,.3)}}
.filter-btn:hover{{border-color:var(--cc,#38b6ff);color:#fff;background:rgba(0,30,80,.50)}}
.filter-btn.active{{background:rgba(30,100,200,.55);border-color:#38b6ff;color:#fff;box-shadow:0 0 14px rgba(56,182,255,.30);font-weight:600}}

/* ── 卡片区 ── */
.main{{max-width:980px;margin:0 auto;padding:20px 16px}}
.count{{color:rgba(255,255,255,.55);font-size:12px;margin-bottom:14px;text-align:right}}

.card{{background:rgba(8,24,60,.78);backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 4px 20px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.08);transition:transform .2s,box-shadow .2s,border-color .2s}}
.card:hover{{transform:translateY(-3px);box-shadow:0 10px 32px rgba(0,0,0,.40),0 0 20px rgba(56,182,255,.18);border-color:rgba(120,210,255,.45)}}
.card-head{{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}}
.tags{{display:flex;flex-wrap:wrap;gap:5px}}
.tag{{padding:3px 10px;border-radius:10px;color:#fff;font-size:11px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.45);text-shadow:0 1px 3px rgba(0,0,0,.45)}}
.pub-date{{color:rgba(255,255,255,.60);font-size:12px;white-space:nowrap;margin-left:8px}}

.title-en{{font-size:15px;line-height:1.6;margin-bottom:5px}}
.title-en a{{color:#eef6ff;text-decoration:none;transition:color .2s;text-shadow:0 1px 4px rgba(0,0,0,.5)}}
.title-en a:hover{{color:#7dd8ff;text-shadow:0 0 12px rgba(56,182,255,.4)}}
.title-zh{{color:#b8d8f0;font-size:14px;line-height:1.7;margin-bottom:8px;text-shadow:0 1px 3px rgba(0,0,0,.4)}}
.authors{{color:rgba(255,255,255,.65);font-size:12px;margin-bottom:12px}}

.actions{{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}}
.btn{{padding:6px 16px;border-radius:8px;font-size:13px;text-decoration:none;font-weight:500;transition:all .2s;border:1px solid transparent;touch-action:manipulation}}
.btn-abs{{background:rgba(56,182,255,.20);color:#7dd8ff;border-color:rgba(56,182,255,.45)}}
.btn-abs:hover{{background:rgba(56,182,255,.35);box-shadow:0 0 14px rgba(56,182,255,.30)}}
.btn-pdf{{background:rgba(255,100,80,.18);color:#ff9077;border-color:rgba(255,100,80,.40)}}
.btn-pdf:hover{{background:rgba(255,100,80,.30);box-shadow:0 0 14px rgba(255,100,80,.25)}}
.btn-html{{background:rgba(52,211,153,.18);color:#34d399;border-color:rgba(52,211,153,.40)}}
.btn-html:hover{{background:rgba(52,211,153,.30);box-shadow:0 0 14px rgba(52,211,153,.25)}}
.github-link{{color:#5ee8b0;font-size:13px;font-weight:600;text-decoration:none;text-shadow:0 0 8px rgba(52,211,153,.35)}}
.github-link:hover{{text-shadow:0 0 16px rgba(52,211,153,.60)}}
.no-github{{color:rgba(255,255,255,.38);font-size:12px}}

.toggle{{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px;color:rgba(255,255,255,.60);touch-action:manipulation;width:100%;transition:all .2s}}
.toggle:hover{{background:rgba(56,182,255,.14);border-color:rgba(120,210,255,.45);color:#7dd8ff}}
.abs-body{{margin-top:10px}}
.abs-en{{color:#c8e0f4;font-size:13px;line-height:1.8;padding:12px 16px;background:rgba(4,14,40,.75);border:1px solid rgba(255,255,255,.12);border-radius:8px;margin-bottom:8px}}
.abs-zh{{color:#d2eafc;font-size:13px;line-height:1.9;padding:12px 16px;background:rgba(8,28,65,.72);border:1px solid rgba(100,180,255,.22);border-radius:8px}}

.no-result{{text-align:center;padding:60px;color:rgba(255,255,255,.40);font-size:15px}}

@media(max-width:600px){{
  .hd-title{{font-size:20px;letter-spacing:2px}}
  .card{{padding:14px}}
  .title-en{{font-size:14px}}
}}
</style>
</head>
<body>
<canvas id="bg"></canvas>

<div class="back-bar">
  <a href="../index.html" class="back-btn">← 返回首页</a>
</div>
<div class="hd">
  <div class="hd-title">◈ ARXIV · CV DAILY ◈</div>
  <div class="sub">COMPUTER VISION AND PATTERN RECOGNITION · DAILY PAPERS</div>
  <div class="tot">{len(papers)} 篇论文 &nbsp;·&nbsp; {today_display}</div>
  <div class="author">curated by binbinyang</div>
</div>
<div class="stats">{stats_html}</div>
<div class="ctrl">
  <input class="search" type="text" placeholder="⌕  搜索论文标题关键词…" oninput="onSearch(this.value)">
  <div class="filters">{filter_btns}</div>
</div>
<div class="main">
  <div class="count" id="cnt">显示 {len(papers)} 篇论文</div>
  <div id="papers">{cards_html}</div>
  <div class="no-result" id="empty" style="display:none">没有找到匹配的论文</div>
</div>

<script>
/* ═══════════════════════════════════════════
   地球 + 卫星背景动画
═══════════════════════════════════════════ */
(function(){{
  var cv=document.getElementById('bg');
  if(!cv)return;
  var ctx=cv.getContext('2d');
  var W,H,ER,ECX,ECY;

  function resize(){{
    W=cv.width=innerWidth; H=cv.height=innerHeight;
    ER=Math.min(W,H)*0.30;
    ECX=W*0.58; ECY=H*0.50;
  }}
  resize(); window.addEventListener('resize',resize);

  /* 星场 */
  var stars=[];
  for(var i=0;i<200;i++) stars.push({{
    x:Math.random(),y:Math.random(),
    r:Math.random()*1.4+0.3,
    a:Math.random()*0.75+0.15,
    da:(Math.random()-0.5)*0.009
  }});

  /* 卫星定义：轨道相对地球半径的倍数，倾角，初始角，颜色 */
  var sats=[
    {{ang:0.0, spd:0.0055, rm:1.42, tilt:-28, r:9, col:'#38b6ff', bcol:'rgba(56,182,255,'}},
    {{ang:2.2, spd:-0.004, rm:1.72, tilt: 40, r:7, col:'#ff9a42', bcol:'rgba(255,154,66,'}},
    {{ang:4.1, spd:0.003,  rm:2.05, tilt: 10, r:8, col:'#34d399', bcol:'rgba(52,211,153,'}},
  ];

  var eRot=0; /* 地球自转角 */

  /* ── 绘制地球 ── */
  function drawEarth(){{
    eRot+=0.0008;
    var r=ER,cx=ECX,cy=ECY,toR=Math.PI/180;

    /* 大气外晕（更亮、更大） */
    var atm=ctx.createRadialGradient(cx,cy,r*0.85,cx,cy,r*1.28);
    atm.addColorStop(0,'rgba(72,168,255,0.16)');
    atm.addColorStop(0.5,'rgba(40,128,230,0.07)');
    atm.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(cx,cy,r*1.28,0,Math.PI*2);ctx.fillStyle=atm;ctx.fill();

    /* 海洋（明亮蓝色） */
    var ocean=ctx.createRadialGradient(cx-r*0.22,cy-r*0.18,0,cx,cy,r);
    ocean.addColorStop(0,'#1e90e0');
    ocean.addColorStop(0.45,'#1460b5');
    ocean.addColorStop(0.80,'#0c3d88');
    ocean.addColorStop(1,'#081f50');
    ctx.save();
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=ocean;ctx.fill();ctx.clip();

    /* 大陆 - 球面正射投影（经纬度真实位置） */
    var lands=[
      [48,-100,75,42,'rgba(55,145,78,0.90)'],
      [-12,-54,42,52,'rgba(40,128,65,0.90)'],
      [50,10,46,32,'rgba(62,152,82,0.88)'],
      [5,22,52,66,'rgba(46,132,68,0.90)'],
      [38,88,96,50,'rgba(50,138,72,0.86)'],
      [-24,134,38,30,'rgba(152,108,50,0.82)'],
      [-82,0,180,8,'rgba(215,232,248,0.52)'],
      [73,-42,36,20,'rgba(198,218,238,0.52)'],
    ];
    lands.sort(function(a,b){{
      return Math.cos(a[0]*toR)*Math.cos(a[1]*toR+eRot)
            -Math.cos(b[0]*toR)*Math.cos(b[1]*toR+eRot);
    }});
    lands.forEach(function(c){{
      var latR=c[0]*toR,lonE=c[1]*toR+eRot;
      var dep=Math.cos(latR)*Math.cos(lonE);
      if(dep<-0.15)return;
      var sx=cx+r*Math.cos(latR)*Math.sin(lonE);
      var sy=cy-r*Math.sin(latR);
      var sxW=r*Math.cos(latR)*(c[2]/2*toR)*Math.max(0.05,Math.abs(Math.cos(lonE)));
      var syH=r*(c[3]/2*toR)*Math.cos(latR);
      var fade=Math.min(1,(dep+0.15)*3.5);
      ctx.save();ctx.globalAlpha=fade;ctx.translate(sx,sy);
      ctx.beginPath();ctx.ellipse(0,0,Math.max(2,sxW),Math.max(2,syH),0,0,Math.PI*2);
      ctx.fillStyle=c[4];ctx.fill();ctx.globalAlpha=1;ctx.restore();
    }});

    /* 经纬线 */
    ctx.strokeStyle='rgba(140,210,255,0.16)';ctx.lineWidth=0.65;
    [-60,-30,0,30,60].forEach(function(d){{
      var lr=d*toR,ylat=cy-r*Math.sin(lr),xlat=r*Math.cos(lr);
      ctx.beginPath();ctx.moveTo(cx-xlat,ylat);ctx.lineTo(cx+xlat,ylat);ctx.stroke();
    }});
    for(var li=0;li<7;li++){{
      var lonM=(li/7)*Math.PI+eRot*0.1;
      var xm=Math.abs(Math.sin(lonM))*r;
      if(xm<r*0.05)continue;
      ctx.save();ctx.translate(cx,cy);
      ctx.beginPath();ctx.ellipse(0,0,xm,r,0,-Math.PI/2,Math.PI/2);
      ctx.stroke();ctx.restore();
    }}

    /* 云层 */
    var cR=eRot*0.55;
    [[0.10,-0.24,0.26,0.055],[-0.22,0.08,0.22,0.048],[0.25,0.12,0.19,0.042],
     [-0.06,-0.06,0.15,0.040],[0.04,0.30,0.18,0.045]
    ].forEach(function(cl,i){{
      ctx.save();ctx.translate(cx+cl[0]*r,cy+cl[1]*r);ctx.rotate(cR+i*1.2);
      ctx.beginPath();ctx.ellipse(0,0,cl[2]*r,cl[3]*r,0,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.16)';ctx.fill();ctx.restore();
    }});

    ctx.restore();

    /* 夜侧阴影（稍浅） */
    ctx.save();
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
    var shd=ctx.createLinearGradient(cx+r*0.06,cy,cx+r*0.88,cy);
    shd.addColorStop(0,'rgba(0,0,0,0)');
    shd.addColorStop(0.58,'rgba(0,5,22,0.52)');
    shd.addColorStop(1,'rgba(0,2,14,0.76)');
    ctx.fillStyle=shd;ctx.fillRect(cx-r,cy-r,r*2,r*2);ctx.restore();

    /* 大气边缘光（更亮） */
    var rim=ctx.createRadialGradient(cx,cy,r*0.84,cx,cy,r*1.06);
    rim.addColorStop(0,'rgba(60,150,255,0)');
    rim.addColorStop(0.55,'rgba(75,172,255,0.18)');
    rim.addColorStop(0.82,'rgba(118,200,255,0.30)');
    rim.addColorStop(1,'rgba(165,222,255,0.05)');
    ctx.beginPath();ctx.arc(cx,cy,r*1.06,0,Math.PI*2);ctx.fillStyle=rim;ctx.fill();

    /* 高光（更亮） */
    var spec=ctx.createRadialGradient(cx-r*0.33,cy-r*0.30,0,cx-r*0.12,cy-r*0.10,r*0.70);
    spec.addColorStop(0,'rgba(255,255,255,0.30)');
    spec.addColorStop(0.38,'rgba(255,255,255,0.07)');
    spec.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=spec;ctx.fill();
  }}

  /* ── 绘制单颗卫星（含太阳能板）── */
  function drawSat(wx,wy,sz,col,bcol,velAng){{
    /* 扫描光束（朝向地球） */
    var toEx=ECX-wx, toEy=ECY-wy;
    var beamLen=Math.sqrt(toEx*toEx+toEy*toEy)*0.55;
    var ba=Math.atan2(toEy,toEx);
    var hw=0.22; /* 半角 */
    ctx.save();
    ctx.translate(wx,wy); ctx.rotate(ba);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(beamLen*Math.cos(hw), beamLen*Math.sin(hw));
    ctx.lineTo(beamLen*Math.cos(-hw),beamLen*Math.sin(-hw));
    ctx.closePath();
    var bg2=ctx.createLinearGradient(0,0,beamLen,0);
    bg2.addColorStop(0,bcol+'0.18)');
    bg2.addColorStop(1,bcol+'0)');
    ctx.fillStyle=bg2; ctx.fill();
    ctx.restore();

    /* 卫星本体 */
    ctx.save();
    ctx.translate(wx,wy); ctx.rotate(velAng);
    var pw=sz*2.6, ph=sz*0.5;
    /* 太阳能板 */
    ctx.fillStyle=bcol+'0.55)';
    ctx.fillRect(-sz/2-pw,-ph/2,pw,ph);
    ctx.fillRect(sz/2,    -ph/2,pw,ph);
    /* 板格线 */
    ctx.strokeStyle=bcol+'0.3)'; ctx.lineWidth=0.6;
    for(var gi=1;gi<3;gi++){{
      ctx.beginPath();
      ctx.moveTo(-sz/2-pw+gi*pw/3,-ph/2);
      ctx.lineTo(-sz/2-pw+gi*pw/3, ph/2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sz/2+gi*pw/3,-ph/2);
      ctx.lineTo(sz/2+gi*pw/3, ph/2); ctx.stroke();
    }}
    /* 主体 */
    ctx.fillStyle=col;
    ctx.fillRect(-sz/2,-sz/2,sz,sz);
    /* 天线 */
    ctx.strokeStyle=bcol+'0.8)'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(0,-sz/2); ctx.lineTo(0,-sz*1.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,-sz*1.8,1.5,0,Math.PI*2);
    ctx.fillStyle=col; ctx.fill();
    ctx.restore();

    /* 卫星光晕 */
    var g=ctx.createRadialGradient(wx,wy,0,wx,wy,sz*4.5);
    g.addColorStop(0,bcol+'0.45)');
    g.addColorStop(1,bcol+'0)');
    ctx.beginPath(); ctx.arc(wx,wy,sz*4.5,0,Math.PI*2);
    ctx.fillStyle=g; ctx.fill();
  }}

  /* ── 绘制所有卫星 ── */
  function drawSatellites(){{
    sats.forEach(function(s){{
      s.ang+=s.spd;
      var orx=ER*s.rm, ory=orx*0.34;
      var tiltR=s.tilt*Math.PI/180;

      /* 轨道路径 */
      ctx.save();
      ctx.translate(ECX,ECY); ctx.rotate(tiltR);
      ctx.beginPath(); ctx.ellipse(0,0,orx,ory,0,0,Math.PI*2);
      ctx.strokeStyle=s.bcol+'0.13)'; ctx.lineWidth=1.2;
      ctx.setLineDash([4,6]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();

      /* 卫星世界坐标 */
      var lx=Math.cos(s.ang)*orx, ly=Math.sin(s.ang)*ory;
      var cosT=Math.cos(tiltR), sinT=Math.sin(tiltR);
      var wx=ECX+lx*cosT-ly*sinT;
      var wy=ECY+lx*sinT+ly*cosT;
      var velAng=Math.atan2(
        (-Math.sin(s.ang)*ory)*cosT+( Math.cos(s.ang)*orx)*sinT,
        (-Math.sin(s.ang)*ory)*(-sinT)+( Math.cos(s.ang)*orx)*cosT
      );
      drawSat(wx,wy,s.r,s.col,s.bcol,velAng);
    }});
  }}

  /* ── 主循环 ── */
  function frame(){{
    ctx.clearRect(0,0,W,H);
    /* 星场 */
    stars.forEach(function(s){{
      s.a+=s.da; if(s.a>0.88||s.a<0.1) s.da*=-1;
      ctx.beginPath(); ctx.arc(s.x*W,s.y*H,s.r,0,Math.PI*2);
      ctx.fillStyle='rgba(200,215,255,'+s.a+')'; ctx.fill();
    }});
    drawEarth();
    drawSatellites();
    requestAnimationFrame(frame);
  }}
  frame();
}})();

/* ── 筛选 & 搜索 ── */
var curFilter='all',curSearch='';
function filterBy(cat,btn){{
  curFilter=cat;
  document.querySelectorAll('.filter-btn').forEach(function(b){{b.classList.remove('active');}});
  btn.classList.add('active'); apply();
}}
function onSearch(q){{curSearch=q.trim().toLowerCase(); apply();}}
function apply(){{
  var cards=document.querySelectorAll('.card'),shown=0;
  cards.forEach(function(c){{
    var matchCat=curFilter==='all'||c.dataset.cats.split('|').indexOf(curFilter)>=0;
    var t=c.querySelector('.title-en').textContent.toLowerCase()
         +c.querySelector('.title-zh').textContent.toLowerCase();
    var show=matchCat&&(!curSearch||t.indexOf(curSearch)>=0);
    c.style.display=show?'':'none'; if(show)shown++;
  }});
  document.getElementById('cnt').textContent='显示 '+shown+' 篇论文';
  document.getElementById('empty').style.display=shown?'none':'block';
}}
function toggle(btn){{
  var body=btn.nextElementSibling,open=!body.hidden;
  body.hidden=open; btn.textContent=open?'展开摘要 ▾':'收起摘要 ▴';
}}
</script>
</body>
</html>"""

    month_dir = os.path.join(base_dir, month_folder)
    os.makedirs(month_dir, exist_ok=True)
    out = os.path.join(month_dir, f"daily_papers_{today}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    return out, today, len(papers), cat_counts


# ── 保存每日统计 ──────────────────────────────────────────────────────────────

def save_paper_stats(base_dir, date_str, total, cat_counts):
    index_json = os.path.join(base_dir, "papers_index.json")
    data = {}
    if os.path.exists(index_json):
        try:
            with open(index_json, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}

    month_folder = datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m")
    data[date_str] = {
        "total":      total,
        "categories": cat_counts,
        "file":       f"{month_folder}/daily_papers_{date_str}.html",
    }

    with open(index_json, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── 生成 index.html ───────────────────────────────────────────────────────────

def generate_index(base_dir):
    index_json = os.path.join(base_dir, "papers_index.json")
    if not os.path.exists(index_json):
        return

    with open(index_json, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_cats = list(CATEGORIES.keys()) + ["其他"]
    updated_time = datetime.now().strftime("%Y年%m月%d日 %H:%M")

    # 按日期降序排列
    sorted_dates = sorted(data.keys(), reverse=True)
    current_year = datetime.now().strftime("%Y")

    # 按年 → 月分组
    years = {}
    for date_str in sorted_dates:
        dt   = datetime.strptime(date_str, "%Y%m%d")
        yr   = dt.strftime("%Y")
        mo   = dt.strftime("%Y-%m")
        years.setdefault(yr, {}).setdefault(mo, []).append(date_str)

    # 生成年份区块 HTML
    months_html = ""
    for yr in sorted(years.keys(), reverse=True):
        yr_months   = years[yr]
        yr_total    = sum(data[d]["total"] for mo in yr_months.values() for d in mo)
        yr_days     = sum(len(mo) for mo in yr_months.values())
        is_current  = (yr == current_year)
        yr_open_cls = "" if is_current else " collapsed"
        yr_body_st  = "" if is_current else ' style="display:none"'

        months_inner = ""
        for month in sorted(yr_months.keys(), reverse=True):
            month_display = datetime.strptime(month, "%Y-%m").strftime("%m月")
            month_total   = sum(data[d]["total"] for d in yr_months[month])

            cards_html = ""
            for date_str in yr_months[month]:
                info         = data[date_str]
                date_obj     = datetime.strptime(date_str, "%Y%m%d")
                date_display = date_obj.strftime("%m月%d日")
                weekdays     = ["周一","周二","周三","周四","周五","周六","周日"]
                weekday      = weekdays[date_obj.weekday()]

                cat_tags = ""
                for cat in all_cats:
                    cnt = info["categories"].get(cat, 0)
                    if cnt:
                        color = CATEGORY_COLORS.get(cat, "#95a5a6")
                        cat_tags += (
                            f'<span class="cat-tag" style="background:{color};color:#fff;'
                            f'opacity:0.92">{cat} {cnt}</span>'
                        )

                cards_html += f"""
<a href="{info["file"]}" class="day-card">
  <div class="day-card-left">
    <div class="day-date">{date_display}</div>
    <div class="day-week">{weekday}</div>
  </div>
  <div class="day-card-body">
    <div class="day-total">{info["total"]} 篇论文</div>
    <div class="day-cats">{cat_tags}</div>
  </div>
  <div class="day-arrow">›</div>
</a>"""

            months_inner += f"""
<div class="month-section">
  <div class="month-header">
    <span class="month-title">{month_display}</span>
    <span class="month-count">{len(yr_months[month])} 天 · {month_total} 篇</span>
  </div>
  <div class="month-cards">{cards_html}</div>
</div>"""

        months_html += f"""
<div class="year-block{yr_open_cls}">
  <div class="year-header" onclick="toggleYear(this)">
    <span class="year-label">{yr} 年</span>
    <span class="year-meta">{yr_days} 天 · {yr_total} 篇</span>
    <span class="year-arrow">{"▾" if is_current else "▸"}</span>
  </div>
  <div class="year-body"{yr_body_st}>{months_inner}</div>
</div>"""

    total_papers = sum(data[d]["total"] for d in sorted_dates)
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>arxiv CV 日报 · 归档</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a3a6e;color:#eef6ff;font-size:15px;min-height:100vh}}
#bg{{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}}
.hd,.summary,.content{{position:relative;z-index:1}}

.hd{{background:rgba(255,255,255,.10);backdrop-filter:blur(24px);color:#fff;padding:38px 20px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.18);box-shadow:0 4px 32px rgba(0,0,0,.18)}}
.hd-title{{font-size:30px;font-weight:800;letter-spacing:5px;background:linear-gradient(90deg,#38b6ff 0%,#a78bfa 45%,#34d399 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 16px rgba(56,182,255,.55))}}
.hd .tagline{{margin-top:9px;color:rgba(255,255,255,.70);font-size:13px;letter-spacing:2.5px}}
.hd .updated{{margin-top:6px;font-size:12px;color:rgba(255,255,255,.50)}}
.author{{margin-top:10px;font-size:12px;color:rgba(255,255,255,.45);letter-spacing:1.5px;font-style:italic}}

.summary{{background:rgba(0,20,60,.35);backdrop-filter:blur(12px);padding:12px 20px;border-bottom:1px solid rgba(255,255,255,.12);text-align:center;color:#cce8ff;font-size:13px;text-shadow:0 1px 3px rgba(0,0,0,.3)}}
.summary span{{color:#7dd8ff;font-weight:700}}

.content{{max-width:720px;margin:0 auto;padding:24px 16px}}

.year-block{{margin-bottom:20px}}
.year-header{{display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(0,20,60,.45);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.18);border-radius:12px;cursor:pointer;transition:background .18s;user-select:none}}
.year-header:hover{{background:rgba(0,30,80,.55)}}
.year-label{{font-size:18px;font-weight:800;color:#7dd8ff;letter-spacing:2px;text-shadow:0 0 14px rgba(56,182,255,.45)}}
.year-meta{{font-size:12px;color:rgba(255,255,255,.60);flex:1}}
.year-arrow{{color:rgba(255,255,255,.55);font-size:16px;transition:transform .2s}}
.year-block.collapsed .year-header{{border-radius:12px}}
.year-body{{padding-top:10px}}

.month-section{{margin-bottom:16px}}
.month-header{{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;padding:0 4px}}
.month-title{{font-size:14px;font-weight:700;color:#a8d8f0;letter-spacing:1px}}
.month-count{{font-size:12px;color:rgba(255,255,255,.50)}}
.month-cards{{background:rgba(255,255,255,.10);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.20);border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.12)}}

.day-card{{display:flex;align-items:center;padding:14px 18px;text-decoration:none;color:inherit;border-bottom:1px solid rgba(255,255,255,.10);transition:background .15s;touch-action:manipulation}}
.day-card:last-child{{border-bottom:none}}
.day-card:hover{{background:rgba(255,255,255,.08)}}

.day-card-left{{width:56px;flex-shrink:0;text-align:center}}
.day-date{{font-size:15px;font-weight:700;color:#eef6ff}}
.day-week{{font-size:11px;color:rgba(255,255,255,.55);margin-top:2px}}

.day-card-body{{flex:1;padding:0 14px}}
.day-total{{font-size:13px;font-weight:600;color:rgba(255,255,255,.80);margin-bottom:7px}}
.day-cats{{display:flex;flex-wrap:wrap;gap:5px}}
.cat-tag{{padding:2px 9px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.50);box-shadow:0 2px 8px rgba(0,0,0,.35)}}

.day-arrow{{color:rgba(255,255,255,.40);font-size:22px;flex-shrink:0}}

.empty{{text-align:center;padding:60px 20px;color:rgba(255,255,255,.40);font-size:15px}}

@media(max-width:500px){{
  .hd-title{{font-size:22px;letter-spacing:3px}}
  .day-card-left{{width:46px}}
  .day-date{{font-size:14px}}
  .year-label{{font-size:16px}}
}}
</style>
</head>
<body>
<canvas id="bg"></canvas>

<div class="hd">
  <div class="hd-title">◈ ARXIV · CV DAILY ◈</div>
  <div class="tagline">COMPUTER VISION AND PATTERN RECOGNITION · DAILY PAPERS</div>
  <div class="updated">最后更新：{updated_time}</div>
  <div class="author">curated by binbinyang</div>
</div>
<div class="summary">共收录 <span>{len(sorted_dates)}</span> 天 · <span>{total_papers}</span> 篇论文</div>
<div class="content">
  {"<div class='empty'>暂无数据，请先运行 fetch_papers.py</div>" if not months_html else months_html}
</div>

<script>
(function(){{
  var cv=document.getElementById('bg');
  if(!cv)return;
  var ctx=cv.getContext('2d');
  var W,H,ER,ECX,ECY;
  function resize(){{
    W=cv.width=innerWidth; H=cv.height=innerHeight;
    ER=Math.min(W,H)*0.30; ECX=W*0.58; ECY=H*0.50;
  }}
  resize(); window.addEventListener('resize',resize);

  var stars=[];
  for(var i=0;i<200;i++) stars.push({{
    x:Math.random(),y:Math.random(),r:Math.random()*1.4+0.3,
    a:Math.random()*0.75+0.15,da:(Math.random()-0.5)*0.009
  }});

  var sats=[
    {{ang:0.0, spd:0.0055, rm:1.42, tilt:-28, r:9, col:'#38b6ff', bcol:'rgba(56,182,255,'}},
    {{ang:2.2, spd:-0.004, rm:1.72, tilt: 40, r:7, col:'#ff9a42', bcol:'rgba(255,154,66,'}},
    {{ang:4.1, spd:0.003,  rm:2.05, tilt: 10, r:8, col:'#34d399', bcol:'rgba(52,211,153,'}},
  ];
  var eRot=0;

  function drawEarth(){{
    eRot+=0.0008;
    var r=ER,cx=ECX,cy=ECY,toR=Math.PI/180;
    var atm=ctx.createRadialGradient(cx,cy,r*0.85,cx,cy,r*1.28);
    atm.addColorStop(0,'rgba(72,168,255,0.16)');
    atm.addColorStop(0.5,'rgba(40,128,230,0.07)');
    atm.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(cx,cy,r*1.28,0,Math.PI*2);ctx.fillStyle=atm;ctx.fill();
    var ocean=ctx.createRadialGradient(cx-r*0.22,cy-r*0.18,0,cx,cy,r);
    ocean.addColorStop(0,'#1e90e0');ocean.addColorStop(0.45,'#1460b5');
    ocean.addColorStop(0.80,'#0c3d88');ocean.addColorStop(1,'#081f50');
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=ocean;ctx.fill();ctx.clip();
    var lands=[
      [48,-100,75,42,'rgba(55,145,78,0.90)'],
      [-12,-54,42,52,'rgba(40,128,65,0.90)'],
      [50,10,46,32,'rgba(62,152,82,0.88)'],
      [5,22,52,66,'rgba(46,132,68,0.90)'],
      [38,88,96,50,'rgba(50,138,72,0.86)'],
      [-24,134,38,30,'rgba(152,108,50,0.82)'],
      [-82,0,180,8,'rgba(215,232,248,0.52)'],
      [73,-42,36,20,'rgba(198,218,238,0.52)'],
    ];
    lands.sort(function(a,b){{
      return Math.cos(a[0]*toR)*Math.cos(a[1]*toR+eRot)
            -Math.cos(b[0]*toR)*Math.cos(b[1]*toR+eRot);
    }});
    lands.forEach(function(c){{
      var latR=c[0]*toR,lonE=c[1]*toR+eRot;
      var dep=Math.cos(latR)*Math.cos(lonE);
      if(dep<-0.15)return;
      var sx=cx+r*Math.cos(latR)*Math.sin(lonE);
      var sy=cy-r*Math.sin(latR);
      var sxW=r*Math.cos(latR)*(c[2]/2*toR)*Math.max(0.05,Math.abs(Math.cos(lonE)));
      var syH=r*(c[3]/2*toR)*Math.cos(latR);
      var fade=Math.min(1,(dep+0.15)*3.5);
      ctx.save();ctx.globalAlpha=fade;ctx.translate(sx,sy);
      ctx.beginPath();ctx.ellipse(0,0,Math.max(2,sxW),Math.max(2,syH),0,0,Math.PI*2);
      ctx.fillStyle=c[4];ctx.fill();ctx.globalAlpha=1;ctx.restore();
    }});
    ctx.strokeStyle='rgba(140,210,255,0.16)';ctx.lineWidth=0.65;
    [-60,-30,0,30,60].forEach(function(d){{
      var lr=d*toR,ylat=cy-r*Math.sin(lr),xlat=r*Math.cos(lr);
      ctx.beginPath();ctx.moveTo(cx-xlat,ylat);ctx.lineTo(cx+xlat,ylat);ctx.stroke();
    }});
    for(var li=0;li<7;li++){{
      var lonM=(li/7)*Math.PI+eRot*0.1;
      var xm=Math.abs(Math.sin(lonM))*r;
      if(xm<r*0.05)continue;
      ctx.save();ctx.translate(cx,cy);
      ctx.beginPath();ctx.ellipse(0,0,xm,r,0,-Math.PI/2,Math.PI/2);
      ctx.stroke();ctx.restore();
    }}
    var cR=eRot*0.55;
    [[0.10,-0.24,0.26,0.055],[-0.22,0.08,0.22,0.048],[0.25,0.12,0.19,0.042],
     [-0.06,-0.06,0.15,0.040],[0.04,0.30,0.18,0.045]
    ].forEach(function(cl,i){{
      ctx.save();ctx.translate(cx+cl[0]*r,cy+cl[1]*r);ctx.rotate(cR+i*1.2);
      ctx.beginPath();ctx.ellipse(0,0,cl[2]*r,cl[3]*r,0,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.16)';ctx.fill();ctx.restore();
    }});
    ctx.restore();
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
    var shd=ctx.createLinearGradient(cx+r*0.06,cy,cx+r*0.88,cy);
    shd.addColorStop(0,'rgba(0,0,0,0)');shd.addColorStop(0.58,'rgba(0,5,22,0.52)');shd.addColorStop(1,'rgba(0,2,14,0.76)');
    ctx.fillStyle=shd;ctx.fillRect(cx-r,cy-r,r*2,r*2);ctx.restore();
    var rim=ctx.createRadialGradient(cx,cy,r*0.84,cx,cy,r*1.06);
    rim.addColorStop(0,'rgba(60,150,255,0)');rim.addColorStop(0.48,'rgba(75,172,255,0.30)');
    rim.addColorStop(0.76,'rgba(118,200,255,0.54)');rim.addColorStop(1,'rgba(165,222,255,0.10)');
    ctx.beginPath();ctx.arc(cx,cy,r*1.10,0,Math.PI*2);ctx.fillStyle=rim;ctx.fill();
    var spec=ctx.createRadialGradient(cx-r*0.33,cy-r*0.30,0,cx-r*0.12,cy-r*0.10,r*0.70);
    spec.addColorStop(0,'rgba(255,255,255,0.30)');spec.addColorStop(0.38,'rgba(255,255,255,0.07)');spec.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=spec;ctx.fill();
  }}

  function drawSat(wx,wy,sz,col,bcol,velAng){{
    var toEx=ECX-wx,toEy=ECY-wy,beamLen=Math.sqrt(toEx*toEx+toEy*toEy)*0.55,ba=Math.atan2(toEy,toEx),hw=0.22;
    ctx.save();ctx.translate(wx,wy);ctx.rotate(ba);
    ctx.beginPath();ctx.moveTo(0,0);
    ctx.lineTo(beamLen*Math.cos(hw),beamLen*Math.sin(hw));
    ctx.lineTo(beamLen*Math.cos(-hw),beamLen*Math.sin(-hw));ctx.closePath();
    var bg2=ctx.createLinearGradient(0,0,beamLen,0);
    bg2.addColorStop(0,bcol+'0.18)');bg2.addColorStop(1,bcol+'0)');
    ctx.fillStyle=bg2;ctx.fill();ctx.restore();
    ctx.save();ctx.translate(wx,wy);ctx.rotate(velAng);
    var pw=sz*2.6,ph=sz*0.5;
    ctx.fillStyle=bcol+'0.55)';
    ctx.fillRect(-sz/2-pw,-ph/2,pw,ph);ctx.fillRect(sz/2,-ph/2,pw,ph);
    ctx.strokeStyle=bcol+'0.3)';ctx.lineWidth=0.6;
    for(var gi=1;gi<3;gi++){{
      ctx.beginPath();ctx.moveTo(-sz/2-pw+gi*pw/3,-ph/2);ctx.lineTo(-sz/2-pw+gi*pw/3,ph/2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(sz/2+gi*pw/3,-ph/2);ctx.lineTo(sz/2+gi*pw/3,ph/2);ctx.stroke();
    }}
    ctx.fillStyle=col;ctx.fillRect(-sz/2,-sz/2,sz,sz);
    ctx.strokeStyle=bcol+'0.8)';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(0,-sz/2);ctx.lineTo(0,-sz*1.8);ctx.stroke();
    ctx.beginPath();ctx.arc(0,-sz*1.8,1.5,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();
    ctx.restore();
    var g=ctx.createRadialGradient(wx,wy,0,wx,wy,sz*4.5);
    g.addColorStop(0,bcol+'0.45)');g.addColorStop(1,bcol+'0)');
    ctx.beginPath();ctx.arc(wx,wy,sz*4.5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
  }}

  function drawSatellites(){{
    sats.forEach(function(s){{
      s.ang+=s.spd;
      var orx=ER*s.rm,ory=orx*0.34,tiltR=s.tilt*Math.PI/180;
      ctx.save();ctx.translate(ECX,ECY);ctx.rotate(tiltR);
      ctx.beginPath();ctx.ellipse(0,0,orx,ory,0,0,Math.PI*2);
      ctx.strokeStyle=s.bcol+'0.13)';ctx.lineWidth=1.2;ctx.setLineDash([4,6]);ctx.stroke();ctx.setLineDash([]);ctx.restore();
      var lx=Math.cos(s.ang)*orx,ly=Math.sin(s.ang)*ory;
      var cosT=Math.cos(tiltR),sinT=Math.sin(tiltR);
      var wx=ECX+lx*cosT-ly*sinT,wy=ECY+lx*sinT+ly*cosT;
      var vx=-Math.sin(s.ang)*orx,vy=Math.cos(s.ang)*ory;
      var velAng=Math.atan2(vx*sinT+vy*cosT,vx*cosT-vy*sinT);
      drawSat(wx,wy,s.r,s.col,s.bcol,velAng);
    }});
  }}

  function frame(){{
    ctx.clearRect(0,0,W,H);
    stars.forEach(function(s){{
      s.a+=s.da;if(s.a>0.88||s.a<0.1)s.da*=-1;
      ctx.beginPath();ctx.arc(s.x*W,s.y*H,s.r,0,Math.PI*2);
      ctx.fillStyle='rgba(200,215,255,'+s.a+')';ctx.fill();
    }});
    drawEarth();drawSatellites();
    requestAnimationFrame(frame);
  }}
  frame();
}})();

function toggleYear(hdr){{
  var block=hdr.parentElement;
  var body=block.querySelector('.year-body');
  var arrow=hdr.querySelector('.year-arrow');
  var open=body.style.display!=='none';
  body.style.display=open?'none':'';
  arrow.textContent=open?'▸':'▾';
  block.classList.toggle('collapsed',open);
}}
</script>
</body>
</html>"""

    out = os.path.join(base_dir, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ 首页已更新: {out}")


# ── Git 推送 ──────────────────────────────────────────────────────────────────

def git_push(base_dir, date_str, total):
    # CI 模式下由 workflow 统一处理 git 操作
    if os.environ.get("CI_SKIP_GIT"):
        print("ℹ️  CI_SKIP_GIT=true，跳过内部 git push")
        return

    date_display = datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m-%d")
    commit_msg   = f"📄 Update: {date_display} - {total}篇"

    def run(cmd):
        result = subprocess.run(
            cmd, cwd=base_dir, capture_output=True, text=True, shell=True
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()

    print("\n正在推送到 GitHub...")

    month_folder = datetime.strptime(date_str, "%Y%m%d").strftime("%Y-%m")
    code, out, err = run(f"git add index.html papers_index.json seen_ids.json {month_folder}/")
    if code != 0:
        print(f"⚠️  git add 失败: {err}")
        return

    code, out, err = run(f'git commit -m "{commit_msg}"')
    if code != 0:
        if "nothing to commit" in out + err:
            print("ℹ️  没有新内容需要提交。")
        else:
            print(f"⚠️  git commit 失败: {err}")
        return

    print(f"✅ git commit: {commit_msg}")

    code, out, err = run("git push origin main")
    if code != 0:
        # 尝试 master 分支
        code2, out2, err2 = run("git push origin master")
        if code2 != 0:
            print(f"⚠️  git push 失败: {err}\n   请检查 SETUP.md 中的 Git 配置说明。")
            return

    print("✅ 已成功推送到 GitHub，GitHub Pages 稍后自动更新。")


# ── 入口 ──────────────────────────────────────────────────────────────────────

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir   = script_dir

    print("=" * 52)
    print("  arxiv CV 论文日报生成器")
    print("=" * 52)

    # 加载已处理 ID
    seen_file = os.path.join(base_dir, "seen_ids.json")
    seen_ids  = set()
    if os.path.exists(seen_file):
        with open(seen_file, "r") as f:
            seen_ids = set(json.load(f))

    # ── 1) 列表页（最全）→ 2) RSS（备用）→ 3) export API（最后保底）──────────
    papers = fetch_today_listing()

    if not papers:
        print("列表页无结果，改用 RSS...")
        papers = fetch_papers_rss()

    if not papers:
        print("RSS 无结果，改用 export API...")
        xml = fetch_papers(max_results=500)
        if not xml:
            print("无法获取数据，退出。")
            return
        papers = parse_papers(xml)
        if not papers:
            print("未解析到论文，退出。")
            return

    new_papers = [p for p in papers if p["arxiv_link"] not in seen_ids]
    print(f"共获取 {len(papers)} 篇，其中新论文 {len(new_papers)} 篇"
          f"（跳过已处理 {len(papers)-len(new_papers)} 篇）")

    if not new_papers:
        print("今日暂无新论文，重新生成索引后退出。")
        generate_index(base_dir)
        return

    papers = new_papers

    # 记录已处理的 ID
    seen_ids.update(p["arxiv_link"] for p in papers)
    with open(seen_file, "w") as f:
        json.dump(list(seen_ids), f)

    papers = translate_papers(papers)

    print("\n生成 HTML 文件中...")
    path, today, total, cat_counts = generate_html(papers, base_dir)
    print(f"✅ 日报已保存: {path}")

    save_paper_stats(base_dir, today, total, cat_counts)
    generate_index(base_dir)

    git_push(base_dir, today, total)

    print(f"\n完成！")
    if not os.environ.get("CI"):
        webbrowser.open(f"file://{path}")


if __name__ == "__main__":
    main()
