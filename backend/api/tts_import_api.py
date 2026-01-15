# backend/api/tts_import_api.py
"""
第三方TTS数据导入API
支持从外部TTS平台导入已生成的语音数据
"""

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import (
    db,
    TrainingContent,
    TtsScript,
    TtsSentence,
    TtsAudio,
    MergedAudioSegment,
)
import uuid
import os
import json
import shutil
from datetime import datetime
from pydub import AudioSegment
from werkzeug.utils import secure_filename
import zipfile
import tempfile


def format_ms_to_srt_time(ms):
    """将毫秒转换为SRT时间格式 HH:MM:SS,mmm"""
    if ms is None:
        ms = 0
    hours = int(ms // 3600000)
    minutes = int((ms % 3600000) // 60000)
    seconds = int((ms % 60000) // 1000)
    milliseconds = int(ms % 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"

tts_import_bp = Blueprint("tts_import", __name__, url_prefix="/api/tts")

# 允许的音频文件扩展名
ALLOWED_AUDIO_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a', 'flac'}

def allowed_audio_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_AUDIO_EXTENSIONS


def get_audio_duration_ms(file_path):
    """获取音频文件时长（毫秒）"""
    try:
        audio = AudioSegment.from_file(file_path)
        return len(audio)
    except Exception as e:
        current_app.logger.warning(f"无法获取音频时长: {file_path}, 错误: {e}")
        return None


@tts_import_bp.route("/training-contents/<uuid:content_id>/import-external", methods=["POST"])
@jwt_required()
def import_external_tts_data(content_id):
    """
    导入第三方TTS数据
    
    请求格式: multipart/form-data
    - json_file: export.json 文件
    - audio_zip: 包含音频文件的ZIP压缩包 (可选，如果提供merged_audio_file则不需要)
    - merged_audio_file: 合并后的音频文件 (可选)
    
    或者使用JSON body (当音频文件已在服务器上时):
    - json_data: JSON字符串
    - audio_folder_path: 服务器上的音频文件夹路径
    """
    current_user_id = get_jwt_identity()
    
    try:
        # 验证 content_id
        content = TrainingContent.query.get(str(content_id))
        if not content:
            return jsonify({"error": "培训内容不存在"}), 404
        
        # 检查是否有最终脚本
        final_script = (
            TtsScript.query.filter_by(
                training_content_id=str(content_id),
                script_type="final_tts_script"
            )
            .order_by(TtsScript.version.desc())
            .first()
        )
        
        if not final_script:
            return jsonify({"error": "请先完成脚本生成和拆分步骤"}), 400
        
        # 解析请求数据
        json_data = None
        audio_folder_path = None
        merged_audio_path = None
        temp_dir = None
        
        if request.content_type and 'multipart/form-data' in request.content_type:
            # 处理文件上传
            if 'json_file' not in request.files:
                return jsonify({"error": "缺少JSON配置文件"}), 400
            
            json_file = request.files['json_file']
            json_data = json.load(json_file)
            
            # 创建临时目录存放上传的文件
            temp_dir = tempfile.mkdtemp()
            audio_folder_path = os.path.join(temp_dir, 'audio')
            os.makedirs(audio_folder_path, exist_ok=True)
            
            # 处理ZIP文件
            if 'audio_zip' in request.files:
                zip_file = request.files['audio_zip']
                zip_path = os.path.join(temp_dir, 'audio.zip')
                zip_file.save(zip_path)
                
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(audio_folder_path)
                
                # 检查是否有嵌套的audio文件夹
                nested_audio = os.path.join(audio_folder_path, 'audio')
                if os.path.isdir(nested_audio):
                    audio_folder_path = nested_audio
            
            # 处理单独上传的合并音频
            if 'merged_audio_file' in request.files:
                merged_file = request.files['merged_audio_file']
                merged_audio_path = os.path.join(temp_dir, secure_filename(merged_file.filename))
                merged_file.save(merged_audio_path)
                
        else:
            # JSON body 方式（服务器本地文件）
            data = request.get_json()
            if not data:
                return jsonify({"error": "缺少请求数据"}), 400
            
            if 'json_file_path' in data:
                # 从服务器路径读取JSON
                json_file_path = data['json_file_path']
                if not os.path.exists(json_file_path):
                    return jsonify({"error": f"JSON文件不存在: {json_file_path}"}), 400
                with open(json_file_path, 'r', encoding='utf-8') as f:
                    json_data = json.load(f)
            elif 'json_data' in data:
                json_data = data['json_data']
            else:
                return jsonify({"error": "缺少json_file_path或json_data"}), 400
            
            audio_folder_path = data.get('audio_folder_path')
            if audio_folder_path and not os.path.isdir(audio_folder_path):
                return jsonify({"error": f"音频文件夹不存在: {audio_folder_path}"}), 400
        
        if not json_data:
            return jsonify({"error": "无法解析JSON数据"}), 400
        
        # 验证JSON结构
        if 'sentences' not in json_data:
            return jsonify({"error": "JSON格式错误：缺少sentences字段"}), 400
        
        # 开始导入处理
        result = process_import(
            content=content,
            final_script=final_script,
            json_data=json_data,
            audio_folder_path=audio_folder_path,
            merged_audio_path=merged_audio_path,
            current_user_id=current_user_id
        )
        
        # 清理临时目录
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        
        return jsonify(result), 200
        
    except json.JSONDecodeError as e:
        return jsonify({"error": f"JSON解析错误: {str(e)}"}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"导入第三方TTS数据失败: {e}", exc_info=True)
        return jsonify({"error": f"导入失败: {str(e)}"}), 500


def cleanup_previous_import(content, content_audio_dir):
    """
    清理之前导入的外部TTS数据（覆盖模式）
    删除 tts_engine='external_import' 的音频记录和对应文件
    """
    current_app.logger.info(f"开始清理 content {content.id} 之前导入的外部数据...")
    
    # 1. 查找并删除外部导入的合并音频及其 segments
    external_merged_audios = TtsAudio.query.filter_by(
        training_content_id=content.id,
        audio_type='merged_audio',
        tts_engine='external_import'
    ).all()
    
    for merged_audio in external_merged_audios:
        # 删除关联的 MergedAudioSegment 记录
        MergedAudioSegment.query.filter_by(merged_audio_id=merged_audio.id).delete()
        
        # 删除物理文件
        if merged_audio.file_path:
            file_full_path = os.path.join(
                current_app.config.get('TTS_AUDIO_PATH', 'backend/static/tts_audio'),
                merged_audio.file_path
            )
            if os.path.exists(file_full_path):
                os.remove(file_full_path)
                current_app.logger.debug(f"删除合并音频文件: {file_full_path}")
            
            # 删除对应的字幕文件
            srt_path = os.path.splitext(file_full_path)[0] + ".txt"
            if os.path.exists(srt_path):
                os.remove(srt_path)
                current_app.logger.debug(f"删除字幕文件: {srt_path}")
        
        db.session.delete(merged_audio)
    
    # 2. 查找并删除外部导入的句子音频
    external_sentence_audios = TtsAudio.query.filter_by(
        training_content_id=content.id,
        audio_type='sentence_audio',
        tts_engine='external_import'
    ).all()
    
    for audio in external_sentence_audios:
        # 删除物理文件
        if audio.file_path:
            file_full_path = os.path.join(
                current_app.config.get('TTS_AUDIO_PATH', 'backend/static/tts_audio'),
                audio.file_path
            )
            if os.path.exists(file_full_path):
                os.remove(file_full_path)
                current_app.logger.debug(f"删除句子音频文件: {file_full_path}")
        
        db.session.delete(audio)
    
    db.session.flush()
    current_app.logger.info(f"清理完成: 删除了 {len(external_merged_audios)} 个合并音频, {len(external_sentence_audios)} 个句子音频")


def process_import(content, final_script, json_data, audio_folder_path, merged_audio_path, current_user_id):
    """
    处理导入逻辑
    """
    # TTS音频存储目录
    tts_audio_base = current_app.config.get('TTS_AUDIO_PATH', 'backend/static/tts_audio')
    content_audio_dir = os.path.join(tts_audio_base, str(content.id))
    os.makedirs(content_audio_dir, exist_ok=True)
    
    # === 覆盖模式：清理之前导入的外部数据 ===
    cleanup_previous_import(content, content_audio_dir)
    
    imported_sentences = []
    imported_audios = []
    total_duration_ms = 0
    
    # 获取现有句子（如果有的话）
    existing_sentences = {
        s.order_index: s 
        for s in TtsSentence.query.filter_by(tts_script_id=final_script.id).all()
    }
    
    sentences_data = json_data.get('sentences', [])
    document_info = json_data.get('document', {})
    
    current_app.logger.info(f"开始导入 {len(sentences_data)} 个句子的TTS数据")
    
    # 用于计算时间戳的累计时长
    cumulative_duration_ms = 0
    segments_for_merged = []
    
    for idx, sent_data in enumerate(sentences_data):
        order_index = sent_data.get('order_index', idx)
        # 使用 original_text 作为主要文本（不含SSML标签）
        original_text = sent_data.get('original_text', '')
        sentence_text = original_text or sent_data.get('current_text', '')
        audio_info = sent_data.get('audio_file', {})
        audio_relative_path = audio_info.get('path', '')
        
        # 查找或创建句子记录
        sentence = existing_sentences.get(order_index)
        if not sentence:
            # 创建新句子 - 使用 UUID 对象而不是字符串
            new_sentence_id = uuid.uuid4()
            sentence = TtsSentence(
                id=new_sentence_id,
                tts_script_id=final_script.id,
                sentence_text=sentence_text,
                order_index=order_index,
                audio_status='pending',
                modified_after_merge=False
            )
            db.session.add(sentence)
            db.session.flush()
        else:
            # 更新现有句子文本（如果不同）
            if sentence.sentence_text != sentence_text:
                sentence.sentence_text = sentence_text
        
        # 处理音频文件
        if audio_relative_path and audio_folder_path:
            source_audio_path = os.path.join(audio_folder_path, audio_relative_path)
            
            # 如果相对路径以 audio/ 开头，尝试去掉
            if not os.path.exists(source_audio_path) and audio_relative_path.startswith('audio/'):
                source_audio_path = os.path.join(audio_folder_path, audio_relative_path[6:])
            
            if os.path.exists(source_audio_path):
                # 生成新的文件名
                file_ext = os.path.splitext(source_audio_path)[1] or '.mp3'
                new_filename = f"{sentence.id}_imported{file_ext}"
                dest_audio_path = os.path.join(content_audio_dir, new_filename)
                
                # 复制音频文件
                shutil.copy2(source_audio_path, dest_audio_path)
                
                # 获取音频时长
                duration_ms = audio_info.get('duration')
                if duration_ms is None:
                    duration_ms = get_audio_duration_ms(dest_audio_path)
                
                # 获取文件大小
                file_size = audio_info.get('file_size') or os.path.getsize(dest_audio_path)
                
                # 标记旧音频为非最新
                TtsAudio.query.filter_by(
                    tts_sentence_id=sentence.id,
                    is_latest_for_sentence=True
                ).update({'is_latest_for_sentence': False})
                
                # 创建音频记录 - 使用 UUID 对象
                new_audio_id = uuid.uuid4()
                relative_path = f"{content.id}/{new_filename}"
                audio_record = TtsAudio(
                    id=new_audio_id,
                    tts_sentence_id=sentence.id,
                    training_content_id=content.id,
                    audio_type='sentence_audio',
                    file_path=relative_path,
                    duration_ms=duration_ms,
                    file_size_bytes=file_size,
                    tts_engine='external_import',
                    voice_name=document_info.get('voice', 'unknown'),
                    generation_params={
                        'source': 'external_import',
                        'original_model': document_info.get('model'),
                        'imported_at': datetime.utcnow().isoformat(),
                        'imported_by': current_user_id
                    },
                    version=1,
                    is_latest_for_sentence=True,
                    is_latest_for_content=False
                )
                db.session.add(audio_record)
                
                # 更新句子状态
                sentence.audio_status = 'generated'
                
                # 记录segment信息用于合并音频 - 保存 UUID 对象
                if duration_ms:
                    segments_for_merged.append({
                        'sentence_id': sentence.id,  # 这里是 UUID 对象
                        'order_index': order_index,
                        'text': original_text,  # 使用 original_text 用于字幕生成
                        'start_ms': cumulative_duration_ms,
                        'end_ms': cumulative_duration_ms + duration_ms,
                        'duration_ms': duration_ms
                    })
                    cumulative_duration_ms += duration_ms
                    total_duration_ms += duration_ms
                
                imported_audios.append(str(audio_record.id))
                current_app.logger.debug(f"导入句子 {order_index} 的音频: {relative_path}")
            else:
                current_app.logger.warning(f"音频文件不存在: {source_audio_path}")
                sentence.audio_status = 'pending'
        
        imported_sentences.append(str(sentence.id))
    
    # 先提交句子和音频记录
    db.session.flush()
    
    # 处理合并音频
    merged_audio_id = None
    if merged_audio_path or (audio_folder_path and os.path.exists(os.path.join(audio_folder_path, 'merged.mp3'))):
        actual_merged_path = merged_audio_path or os.path.join(audio_folder_path, 'merged.mp3')
        
        if os.path.exists(actual_merged_path):
            # 复制合并音频
            merged_filename = f"merged_{content.id}_imported.mp3"
            dest_merged_path = os.path.join(content_audio_dir, merged_filename)
            shutil.copy2(actual_merged_path, dest_merged_path)
            
            merged_duration = get_audio_duration_ms(dest_merged_path)
            merged_size = os.path.getsize(dest_merged_path)
            
            # 标记旧的合并音频为非最新
            TtsAudio.query.filter_by(
                training_content_id=content.id,
                audio_type='merged_audio',
                is_latest_for_content=True
            ).update({'is_latest_for_content': False})
            
            # 创建合并音频记录 - 使用 UUID 对象
            new_merged_audio_id = uuid.uuid4()
            merged_relative_path = f"{content.id}/{merged_filename}"
            merged_audio = TtsAudio(
                id=new_merged_audio_id,
                tts_sentence_id=None,
                training_content_id=content.id,
                audio_type='merged_audio',
                file_path=merged_relative_path,
                duration_ms=merged_duration or total_duration_ms,
                file_size_bytes=merged_size,
                tts_engine='external_import',
                voice_name=document_info.get('voice', 'unknown'),
                generation_params={
                    'source': 'external_import',
                    'original_model': document_info.get('model'),
                    'total_sentences': len(sentences_data),
                    'imported_at': datetime.utcnow().isoformat()
                },
                version=1,
                is_latest_for_sentence=False,
                is_latest_for_content=True
            )
            db.session.add(merged_audio)
            db.session.flush()
            merged_audio_id = merged_audio.id
            
            # 创建 MergedAudioSegment 记录 - 逐个添加并flush避免批量插入问题
            for seg in segments_for_merged:
                new_segment_id = uuid.uuid4()
                segment = MergedAudioSegment(
                    id=new_segment_id,
                    merged_audio_id=merged_audio.id,
                    tts_sentence_id=seg['sentence_id'],  # 已经是 UUID 对象
                    original_order_index=seg['order_index'],
                    original_sentence_text_ref=seg['text'][:500] if seg['text'] else None,
                    start_ms=seg['start_ms'],
                    end_ms=seg['end_ms'],
                    duration_ms=seg['duration_ms']
                )
                db.session.add(segment)
            
            # 生成字幕文件 (.txt) - 用于第6步视频合成
            srt_content_lines = []
            for i, seg in enumerate(segments_for_merged):
                srt_content_lines.append(str(i + 1))
                start_time_srt = format_ms_to_srt_time(seg['start_ms'])
                end_time_srt = format_ms_to_srt_time(seg['end_ms'])
                srt_content_lines.append(f"{start_time_srt} --> {end_time_srt}")
                srt_content_lines.append(seg['text'] or "")
                srt_content_lines.append("")  # 每个字幕块后的空行
            
            srt_content = "\n".join(srt_content_lines)
            
            # 字幕文件路径与合并音频路径相同，只是扩展名为 .txt
            srt_txt_filename = f"merged_{content.id}_imported.txt"
            srt_txt_full_path = os.path.join(content_audio_dir, srt_txt_filename)
            
            try:
                with open(srt_txt_full_path, "w", encoding="utf-8") as f:
                    f.write(srt_content)
                current_app.logger.info(f"成功生成字幕文件: {srt_txt_full_path}, 共 {len(segments_for_merged)} 条字幕")
            except (IOError, OSError) as e:
                current_app.logger.error(f"写入字幕文件失败: {e}")
                # 不中断导入流程，但记录错误
            
            current_app.logger.info(f"导入合并音频: {merged_relative_path}, 时长: {merged_duration}ms")
    
    # 更新内容状态
    if merged_audio_id:
        content.status = 'audio_merge_complete'
    elif imported_audios:
        content.status = 'audio_generation_complete'
    
    db.session.commit()
    
    return {
        "message": f"成功导入 {len(imported_sentences)} 个句子，{len(imported_audios)} 个音频文件",
        "imported_sentences": len(imported_sentences),
        "imported_audios": len(imported_audios),
        "merged_audio_id": str(merged_audio_id) if merged_audio_id else None,
        "total_duration_ms": total_duration_ms,
        "new_status": content.status
    }


@tts_import_bp.route("/training-contents/<uuid:content_id>/import-from-server", methods=["POST"])
@jwt_required()
def import_from_server_path(content_id):
    """
    从服务器本地路径导入TTS数据
    
    请求体:
    {
        "json_file_path": "instance/uploads/xxx_export/export.json",
        "audio_folder_path": "instance/uploads/xxx_export/audio"  // 可选
    }
    """
    data = request.get_json()
    if not data or 'json_file_path' not in data:
        return jsonify({"error": "缺少json_file_path参数"}), 400
    
    json_file_path = data['json_file_path']
    audio_folder_path = data.get('audio_folder_path')
    
    # 如果没有指定audio_folder_path，尝试从json_file_path推断
    if not audio_folder_path:
        json_dir = os.path.dirname(json_file_path)
        potential_audio_dir = os.path.join(json_dir, 'audio')
        if os.path.isdir(potential_audio_dir):
            audio_folder_path = potential_audio_dir
    
    # 检查合并音频
    merged_audio_path = None
    if audio_folder_path:
        potential_merged = os.path.join(audio_folder_path, 'merged.mp3')
        if os.path.exists(potential_merged):
            merged_audio_path = potential_merged
    
    # 验证路径
    if not os.path.exists(json_file_path):
        return jsonify({"error": f"JSON文件不存在: {json_file_path}"}), 400
    
    if audio_folder_path and not os.path.isdir(audio_folder_path):
        return jsonify({"error": f"音频文件夹不存在: {audio_folder_path}"}), 400
    
    try:
        # 读取JSON
        with open(json_file_path, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
        
        # 验证content
        content = TrainingContent.query.get(str(content_id))
        if not content:
            return jsonify({"error": "培训内容不存在"}), 404
        
        final_script = (
            TtsScript.query.filter_by(
                training_content_id=str(content_id),
                script_type="final_tts_script"
            )
            .order_by(TtsScript.version.desc())
            .first()
        )
        
        if not final_script:
            return jsonify({"error": "请先完成脚本生成和拆分步骤"}), 400
        
        current_user_id = get_jwt_identity()
        
        result = process_import(
            content=content,
            final_script=final_script,
            json_data=json_data,
            audio_folder_path=audio_folder_path,
            merged_audio_path=merged_audio_path,
            current_user_id=current_user_id
        )
        
        return jsonify(result), 200
        
    except json.JSONDecodeError as e:
        return jsonify({"error": f"JSON解析错误: {str(e)}"}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"从服务器路径导入失败: {e}", exc_info=True)
        return jsonify({"error": f"导入失败: {str(e)}"}), 500
