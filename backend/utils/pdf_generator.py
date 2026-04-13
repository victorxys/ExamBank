# backend/utils/pdf_generator.py
import os
import json
import logging
from io import BytesIO
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage
from flask import current_app

logger = logging.getLogger(__name__)

def register_fonts():
    """
    注册中文字体。在 Mac 上优先使用系统自带的 STHeiti。
    """
    font_paths = [
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        # 兼容 Linux 环境的路径（如果将来部署）
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ]
    
    registered = False
    for path in font_paths:
        if os.path.exists(path):
            try:
                # 对于 .ttc 文件，ReportLab 的 TTFont 支持指定 fontNumber
                # STHeiti Medium.ttc 通常索引 0 就可以
                pdfmetrics.registerFont(TTFont('ChineseFont', path))
                logger.info(f"成功注册中文字体: {path}")
                registered = True
                break
            except Exception as e:
                logger.warn(f"注册字体 {path} 失败: {e}")
    
    if not registered:
        logger.error("未能注册任何中文字体，PDF 可能显示乱码。")

# 预先注册字体
register_fonts()

def generate_alignment_pdf(output_stream, synthesis_task, training_content, orientation='portrait'):
    """
    生成 PDF 讲义。
    :param output_stream: 输出流 (BytesIO)
    :param synthesis_task: VideoSynthesis 对象
    :param training_content: TrainingContent 对象
    :param orientation: 'portrait' 或 'landscape'
    """
    is_landscape = (orientation == 'landscape')
    page_size = landscape(A4) if is_landscape else A4
    page_width, page_height = page_size
    
    # 基础边距
    margin = 40
    content_width = page_width - 2 * margin
    
    doc = SimpleDocTemplate(
        output_stream,
        pagesize=page_size,
        rightMargin=margin,
        leftMargin=margin,
        topMargin=margin,
        bottomMargin=margin
    )
    
    styles = getSampleStyleSheet()
    # 定义中文字体样式
    chinese_style = ParagraphStyle(
        'ChineseStyle',
        parent=styles['Normal'],
        fontName='ChineseFont',
        fontSize=12,
        leading=16,
        spaceBefore=6,
        spaceAfter=6
    )
    
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        fontName='ChineseFont',
        fontSize=18,
        alignment=1, # Center
        spaceAfter=20
    )
    
    page_num_style = ParagraphStyle(
        'PageNumStyle',
        parent=styles['Normal'],
        fontName='ChineseFont',
        fontSize=10,
        alignment=2, # Right
    )

    story = []
    
    # 1. 标题页（可选，这里直接作为第一页的页眉）
    title = training_content.content_name or "未命名内容"
    story.append(Paragraph(f"{title} - 讲义", title_style))
    story.append(Spacer(1, 10))
    
    # 2. 解析数据
    video_script_json = synthesis_task.video_script_json
    if not video_script_json or 'video_scripts' not in video_script_json:
        story.append(Paragraph("暂无视频脚本数据", chinese_style))
        doc.build(story)
        return

    # 按 ppt_page 分组
    scripts = video_script_json['video_scripts']
    grouped_scripts = {}
    for item in scripts:
        page = item.get('ppt_page')
        if page not in grouped_scripts:
            grouped_scripts[page] = []
        grouped_scripts[page].append(item.get('text', ''))

    # 获取图片路径
    ppt_image_paths = synthesis_task.ppt_image_paths or []
    # 假设 ppt_image_paths 是相对 UPLOAD_FOLDER 的路径
    upload_folder = current_app.config.get('UPLOAD_FOLDER')
    
    # 遍历页面
    sorted_pages = sorted(grouped_scripts.keys())
    for idx, page_num in enumerate(sorted_pages):
        # 查找对应的图片
        # 假设图片名包含页码，或者按顺序排列
        # synthesis_task.ppt_image_paths 存储的是 ["path/to/slide_1.jpg", ...]
        img_path_rel = None
        # 策略：寻找路径中包含 "slide_{page_num}." 的图片，或者简单按索引（如果页码从1开始）
        for p in ppt_image_paths:
            filename = os.path.basename(p)
            if f"slide_{page_num}." in filename.lower():
                img_path_rel = p
                break
        
        if not img_path_rel and page_num <= len(ppt_image_paths):
            img_path_rel = ppt_image_paths[page_num - 1]

        story.append(Paragraph(f"第 {page_num} 页", chinese_style))
        
        # 插入图片
        if img_path_rel:
            img_path_abs = os.path.join(upload_folder, img_path_rel)
            if os.path.exists(img_path_abs):
                try:
                    with PILImage.open(img_path_abs) as pil_img:
                        img_w, img_h = pil_img.size
                        aspect = img_h / float(img_w)
                        
                        # 计算缩放
                        display_w = content_width
                        display_h = display_w * aspect
                        
                        # 如果是横版，限制图片高度，以免占满全页
                        max_img_h = page_height * (0.4 if is_landscape else 0.5)
                        if display_h > max_img_h:
                            display_h = max_img_h
                            display_w = display_h / aspect
                        
                        story.append(Image(img_path_abs, width=display_w, height=display_h))
                except Exception as e:
                    logger.error(f"加载图片失败: {img_path_abs}, {e}")
                    story.append(Paragraph(f"[图片加载失败: {os.path.basename(img_path_rel)}]", chinese_style))
            else:
                logger.warn(f"图片文件不存在: {img_path_abs}")
                story.append(Paragraph("[图片文件丢失]", chinese_style))
        else:
            story.append(Paragraph("[无对应幻灯片图片]", chinese_style))
        
        story.append(Spacer(1, 12))
        
        # 插入文字
        page_texts = grouped_scripts[page_num]
        for t in page_texts:
            if t:
                # 处理可能存在的换行符
                clean_text = t.replace('\n', '<br/>')
                story.append(Paragraph(clean_text, chinese_style))
        
        # 分页
        if idx < len(sorted_pages) - 1:
            story.append(PageBreak())

    doc.build(story)
