#!/usr/bin/env python3
"""
脚本：修复动态表单中的签名字段类型

将 type='image' 且 title 包含"签名"或"签字"的字段转换为 type='signaturepad'

使用方法:
    python scripts/fix_signature_fields.py [--dry-run]

参数:
    --dry-run: 只显示将要修改的内容，不实际执行修改
"""

import os
import sys
import json
import argparse

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from psycopg2.extras import RealDictCursor

# 数据库连接配置
DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://postgres:xys131313@localhost:5432/ExamDB'
)


def get_db_connection():
    """获取数据库连接"""
    return psycopg2.connect(DATABASE_URL)


def find_signature_fields(surveyjs_schema):
    """
    在 surveyjs_schema 中查找需要转换为 signaturepad 的字段
    
    规则：
    1. type 为 'image'
    2. title 包含 '签名' 或 '签字'
    
    返回需要修改的字段名列表
    """
    signature_fields = []
    
    if not surveyjs_schema or 'pages' not in surveyjs_schema:
        return signature_fields
    
    for page in surveyjs_schema.get('pages', []):
        for element in page.get('elements', []):
            element_type = element.get('type', '')
            element_title = element.get('title', '')
            element_name = element.get('name', '')
            
            # 检查是否是需要转换的签名字段
            if element_type == 'image' and ('签名' in element_title or '签字' in element_title):
                signature_fields.append({
                    'name': element_name,
                    'title': element_title,
                    'current_type': element_type
                })
    
    return signature_fields


def convert_to_signaturepad(surveyjs_schema, field_names):
    """
    将指定字段转换为 signaturepad 类型
    
    返回修改后的 schema
    """
    if not surveyjs_schema or 'pages' not in surveyjs_schema:
        return surveyjs_schema
    
    # 深拷贝避免修改原对象
    import copy
    new_schema = copy.deepcopy(surveyjs_schema)
    
    for page in new_schema.get('pages', []):
        for i, element in enumerate(page.get('elements', [])):
            if element.get('name') in field_names:
                # 保留原有属性，修改类型并添加 signaturepad 特有属性
                old_title = element.get('title', '签名')
                old_name = element.get('name')
                old_visible = element.get('visible', True)
                old_required = element.get('isRequired', False)
                
                # 创建新的 signaturepad 元素
                page['elements'][i] = {
                    'name': old_name,
                    'type': 'signaturepad',
                    'title': old_title,
                    'visible': old_visible,
                    'isRequired': old_required,
                    'signatureWidth': 500,
                    'signatureHeight': 200,
                    'penColor': 'black',
                    'showPlaceholder': True,
                    'placeholder': '请在此处签名'
                }
    
    return new_schema


def main():
    parser = argparse.ArgumentParser(description='修复动态表单中的签名字段类型')
    parser.add_argument('--dry-run', action='store_true', help='只显示将要修改的内容，不实际执行')
    args = parser.parse_args()
    
    print("=" * 60)
    print("动态表单签名字段修复脚本")
    print("=" * 60)
    
    if args.dry_run:
        print("\n[DRY RUN 模式] 不会实际修改数据库\n")
    
    conn = get_db_connection()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 查询所有动态表单
            cur.execute("""
                SELECT id, name, form_token, surveyjs_schema
                FROM dynamic_form
                WHERE surveyjs_schema IS NOT NULL
                ORDER BY name
            """)
            forms = cur.fetchall()
            
            print(f"找到 {len(forms)} 个动态表单\n")
            
            forms_to_update = []
            
            for form in forms:
                form_id = form['id']
                form_name = form['name']
                form_token = form['form_token']
                schema = form['surveyjs_schema']
                
                # 查找需要转换的签名字段
                signature_fields = find_signature_fields(schema)
                
                if signature_fields:
                    print(f"📋 表单: {form_name} (token: {form_token})")
                    for field in signature_fields:
                        print(f"   └─ 字段: {field['name']} | 标题: {field['title']} | 当前类型: {field['current_type']}")
                    
                    # 转换 schema
                    field_names = [f['name'] for f in signature_fields]
                    new_schema = convert_to_signaturepad(schema, field_names)
                    
                    forms_to_update.append({
                        'id': form_id,
                        'name': form_name,
                        'form_token': form_token,
                        'new_schema': new_schema,
                        'fields': signature_fields
                    })
            
            print("\n" + "-" * 60)
            print(f"需要更新的表单数量: {len(forms_to_update)}")
            
            if not forms_to_update:
                print("\n没有需要修复的表单")
                return
            
            if args.dry_run:
                print("\n[DRY RUN] 以下表单将被更新:")
                for form in forms_to_update:
                    print(f"  - {form['name']} ({form['form_token']})")
                print("\n运行不带 --dry-run 参数以执行实际更新")
                return
            
            # 执行更新
            print("\n开始更新...")
            
            for form in forms_to_update:
                cur.execute("""
                    UPDATE dynamic_form
                    SET surveyjs_schema = %s,
                        updated_at = NOW()
                    WHERE id = %s
                """, (json.dumps(form['new_schema']), form['id']))
                print(f"  ✅ 已更新: {form['name']} ({form['form_token']})")
            
            conn.commit()
            print(f"\n✅ 成功更新 {len(forms_to_update)} 个表单")
            
    except Exception as e:
        conn.rollback()
        print(f"\n❌ 错误: {e}")
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
