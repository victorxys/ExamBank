#!/usr/bin/env python3
"""
将现有合同的 base64 签名数据迁移到文件系统

使用方法:
    python scripts/migrate_signatures_to_files.py

注意:
    - 此脚本应在数据库迁移之前运行
    - 会自动跳过已迁移的签名
    - 支持断点续传
"""
import os
import sys
import uuid
import base64
from pathlib import Path
from datetime import datetime

# 添加项目路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app import app
from backend.models import db, BaseContract, ContractSignature


def migrate_signatures(dry_run=False):
    """
    迁移所有合同签名到文件系统
    
    Args:
        dry_run: 如果为 True，只检查不实际迁移
    """
    with app.app_context():
        print("=" * 60)
        print("合同签名数据迁移工具")
        print("=" * 60)
        print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"模式: {'试运行（不会实际修改数据）' if dry_run else '正式迁移'}")
        print()
        
        # 获取所有有签名的合同
        contracts = BaseContract.query.filter(
            db.or_(
                BaseContract.customer_signature.isnot(None),
                BaseContract.employee_signature.isnot(None)
            )
        ).all()
        
        print(f"找到 {len(contracts)} 个包含签名的合同")
        print()
        
        if len(contracts) == 0:
            print("没有需要迁移的签名数据")
            return
        
        # 创建签名存储目录
        signatures_dir = Path(app.root_path) / 'static' / 'signatures'
        if not dry_run:
            signatures_dir.mkdir(parents=True, exist_ok=True)
            print(f"签名存储目录: {signatures_dir}")
        else:
            print(f"签名将存储到: {signatures_dir}")
        print()
        
        migrated_count = 0
        skipped_count = 0
        error_count = 0
        
        for idx, contract in enumerate(contracts, 1):
            print(f"[{idx}/{len(contracts)}] 处理合同: {contract.id}")
            
            try:
                # 迁移客户签名
                if contract.customer_signature:
                    result = migrate_single_signature(
                        contract, 
                        'customer', 
                        contract.customer_signature,
                        signatures_dir,
                        dry_run
                    )
                    if result == 'migrated':
                        migrated_count += 1
                    elif result == 'skipped':
                        skipped_count += 1
                
                # 迁移员工签名
                if contract.employee_signature:
                    result = migrate_single_signature(
                        contract,
                        'employee',
                        contract.employee_signature,
                        signatures_dir,
                        dry_run
                    )
                    if result == 'migrated':
                        migrated_count += 1
                    elif result == 'skipped':
                        skipped_count += 1
                
                if not dry_run:
                    db.session.commit()
                
            except Exception as e:
                if not dry_run:
                    db.session.rollback()
                error_count += 1
                print(f"  ✗ 错误: {e}")
                import traceback
                traceback.print_exc()
        
        print()
        print("=" * 60)
        print("迁移完成")
        print("=" * 60)
        print(f"总计: {len(contracts)} 个合同")
        print(f"  新迁移: {migrated_count} 个签名")
        print(f"  已存在（跳过）: {skipped_count} 个签名")
        print(f"  失败: {error_count} 个签名")
        print(f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        if dry_run:
            print("⚠️  这是试运行，没有实际修改数据")
            print("   移除 --dry-run 参数以执行实际迁移")
        elif error_count > 0:
            print("⚠️  部分签名迁移失败，请检查错误日志")
            return 1
        else:
            print("✓ 所有签名迁移成功！")
            return 0


def migrate_single_signature(contract, signature_type, signature_data, signatures_dir, dry_run=False):
    """
    迁移单个签名
    
    Returns:
        'migrated': 成功迁移
        'skipped': 已存在，跳过
        'error': 迁移失败
    """
    # 检查是否已存在
    existing = ContractSignature.query.filter_by(
        contract_id=contract.id,
        signature_type=signature_type
    ).first()
    
    if existing:
        print(f"  ○ {signature_type} 签名已存在，跳过")
        return 'skipped'
    
    try:
        # 解析 base64 数据
        if signature_data.startswith('data:image'):
            # 格式: data:image/png;base64,iVBORw0KG...
            header, encoded = signature_data.split(',', 1)
            mime_type = header.split(';')[0].split(':')[1]
            extension = mime_type.split('/')[1]
        else:
            # 假设是纯 base64
            encoded = signature_data
            mime_type = 'image/png'
            extension = 'png'
        
        # 解码图片数据
        image_data = base64.b64decode(encoded)
        image_size = len(image_data)
        
        # 生成文件名
        filename = f"contract_{contract.id}_{signature_type}_{uuid.uuid4()}.{extension}"
        file_path = signatures_dir / filename
        relative_path = f"static/signatures/{filename}"
        
        if not dry_run:
            # 保存文件
            with open(file_path, 'wb') as f:
                f.write(image_data)
            
            # 创建数据库记录
            signature_record = ContractSignature(
                contract_id=contract.id,
                signature_type=signature_type,
                file_path=relative_path,
                mime_type=mime_type
            )
            db.session.add(signature_record)
        
        print(f"  ✓ {signature_type} 签名: {filename} ({image_size} bytes)")
        return 'migrated'
        
    except Exception as e:
        print(f"  ✗ {signature_type} 签名迁移失败: {e}")
        raise


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='迁移合同签名到文件系统')
    parser.add_argument('--dry-run', action='store_true', 
                       help='试运行模式，不实际修改数据')
    
    args = parser.parse_args()
    
    exit_code = migrate_signatures(dry_run=args.dry_run)
    sys.exit(exit_code or 0)
