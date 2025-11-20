# 生产环境升级指南：合同数据优化

## 概述
本次升级将移除 `contracts` 表中的大字段（`template_content`、`customer_signature`、`employee_signature`），并实现签名文件外部化存储。

## ⚠️ 重要提醒
- **破坏性变更**：此次升级涉及数据库结构变更和数据迁移
- **停机时间**：建议在低峰期执行，预计需要 15-30 分钟
- **备份必需**：升级前必须完整备份数据库

---

## 升级步骤

### 第一步：准备工作（升级前 1 天）

#### 1.1 备份生产数据库
```bash
# 连接到生产服务器
ssh your-production-server

# 创建完整数据库备份
pg_dump -h localhost -U your_db_user -d examdb > /backup/examdb_backup_$(date +%Y%m%d_%H%M%S).sql

# 验证备份文件
ls -lh /backup/examdb_backup_*.sql
```

#### 1.2 检查现有数据
```bash
# 进入 Python 环境
cd /path/to/examdb
source venv/bin/activate
flask shell

# 执行以下 Python 代码检查数据
from backend.models import BaseContract, db

# 统计有签名的合同数量
contracts_with_customer_sig = BaseContract.query.filter(BaseContract.customer_signature.isnot(None)).count()
contracts_with_employee_sig = BaseContract.query.filter(BaseContract.employee_signature.isnot(None)).count()

print(f"有客户签名的合同: {contracts_with_customer_sig}")
print(f"有员工签名的合同: {contracts_with_employee_sig}")

# 检查 template_content
contracts_with_template = BaseContract.query.filter(BaseContract.template_content.isnot(None)).count()
print(f"有模板内容的合同: {contracts_with_template}")

exit()
```

#### 1.3 创建签名存储目录
```bash
# 在生产服务器上创建目录
mkdir -p /path/to/examdb/backend/static/signatures
chmod 755 /path/to/examdb/backend/static/signatures

# 确认目录权限
ls -ld /path/to/examdb/backend/static/signatures
```

---

### 第二步：创建数据迁移脚本

在本地开发环境创建迁移脚本，然后部署到生产环境。

#### 2.1 创建签名数据迁移脚本
```bash
# 在本地开发环境
cd /Users/victor/develop/examdb
```

创建文件 `scripts/migrate_signatures_to_files.py`：

```python
#!/usr/bin/env python3
"""
将现有合同的 base64 签名数据迁移到文件系统
"""
import os
import sys
import uuid
import base64
from pathlib import Path

# 添加项目路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app import create_app
from backend.models import db, BaseContract, ContractSignature

def migrate_signatures():
    app = create_app()
    
    with app.app_context():
        # 获取所有有签名的合同
        contracts = BaseContract.query.filter(
            db.or_(
                BaseContract.customer_signature.isnot(None),
                BaseContract.employee_signature.isnot(None)
            )
        ).all()
        
        print(f"找到 {len(contracts)} 个需要迁移签名的合同")
        
        signatures_dir = Path(app.root_path) / 'static' / 'signatures'
        signatures_dir.mkdir(parents=True, exist_ok=True)
        
        migrated_count = 0
        error_count = 0
        
        for contract in contracts:
            try:
                # 迁移客户签名
                if contract.customer_signature:
                    migrate_single_signature(
                        contract, 
                        'customer', 
                        contract.customer_signature,
                        signatures_dir
                    )
                    migrated_count += 1
                
                # 迁移员工签名
                if contract.employee_signature:
                    migrate_single_signature(
                        contract,
                        'employee',
                        contract.employee_signature,
                        signatures_dir
                    )
                    migrated_count += 1
                
                db.session.commit()
                print(f"✓ 合同 {contract.id} 签名迁移成功")
                
            except Exception as e:
                db.session.rollback()
                error_count += 1
                print(f"✗ 合同 {contract.id} 迁移失败: {e}")
        
        print(f"\n迁移完成:")
        print(f"  成功: {migrated_count} 个签名")
        print(f"  失败: {error_count} 个签名")

def migrate_single_signature(contract, signature_type, signature_data, signatures_dir):
    """迁移单个签名"""
    # 检查是否已存在
    existing = ContractSignature.query.filter_by(
        contract_id=contract.id,
        signature_type=signature_type
    ).first()
    
    if existing:
        print(f"  签名已存在，跳过: {contract.id} - {signature_type}")
        return
    
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
    
    # 生成文件名
    filename = f"contract_{contract.id}_{signature_type}_{uuid.uuid4()}.{extension}"
    file_path = signatures_dir / filename
    
    # 保存文件
    with open(file_path, 'wb') as f:
        f.write(image_data)
    
    # 创建数据库记录
    signature_record = ContractSignature(
        contract_id=contract.id,
        signature_type=signature_type,
        file_path=f"static/signatures/{filename}",
        mime_type=mime_type
    )
    db.session.add(signature_record)

if __name__ == '__main__':
    migrate_signatures()
```

---

### 第三步：执行升级（停机维护窗口）

#### 3.1 停止应用服务
```bash
# 停止 Web 服务（根据您的部署方式调整）
sudo systemctl stop examdb-web
# 或
sudo supervisorctl stop examdb

# 停止 Celery 任务队列
sudo systemctl stop examdb-celery
# 或
sudo supervisorctl stop examdb-celery
```

#### 3.2 拉取最新代码
```bash
cd /path/to/examdb
git fetch origin
git checkout main  # 或您的生产分支
git pull origin main
```

#### 3.3 安装依赖（如有更新）
```bash
source venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

#### 3.4 执行签名数据迁移
```bash
# 确保在虚拟环境中
source venv/bin/activate

# 执行迁移脚本
python scripts/migrate_signatures_to_files.py

# 检查输出，确认所有签名都成功迁移
```

#### 3.5 执行数据库迁移
```bash
# 应用 Alembic 迁移
flask db upgrade

# 这将执行以下操作：
# 1. 创建 contract_signatures 表
# 2. 删除 contracts 表的 customer_signature 列
# 3. 删除 contracts 表的 employee_signature 列
# 4. 删除 contracts 表的 template_content 列
```

#### 3.6 验证数据迁移
```bash
flask shell

# 执行验证
from backend.models import BaseContract, ContractSignature, db

# 检查签名记录
sig_count = ContractSignature.query.count()
print(f"ContractSignature 记录数: {sig_count}")

# 随机检查一个合同
contract = BaseContract.query.first()
if contract:
    sigs = contract.signatures.all()
    print(f"合同 {contract.id} 的签名数: {len(sigs)}")
    for sig in sigs:
        print(f"  - {sig.signature_type}: {sig.file_path}")
        # 检查文件是否存在
        import os
        if os.path.exists(sig.file_path):
            print(f"    ✓ 文件存在")
        else:
            print(f"    ✗ 文件不存在!")

exit()
```

#### 3.7 构建前端（如有更新）
```bash
cd frontend
npm run build
cd ..
```

#### 3.8 重启服务
```bash
# 启动 Web 服务
sudo systemctl start examdb-web
# 或
sudo supervisorctl start examdb

# 启动 Celery
sudo systemctl start examdb-celery
# 或
sudo supervisorctl start examdb-celery

# 检查服务状态
sudo systemctl status examdb-web
sudo systemctl status examdb-celery
```

---

### 第四步：验证升级结果

#### 4.1 功能测试
1. **查看现有合同**：
   - 访问一个已有签名的合同
   - 确认签名图片正确显示
   - 确认模板内容正确显示

2. **创建新合同**：
   - 创建一个新合同
   - 确认模板内容正确加载

3. **签署合同**：
   - 签署一个合同（客户和员工）
   - 确认签名保存成功
   - 确认签名图片正确显示

4. **下载 PDF**：
   - 下载一个合同的 PDF
   - 确认签名图片正确嵌入

#### 4.2 检查日志
```bash
# 查看应用日志
tail -f /var/log/examdb/app.log

# 查看 Nginx/Apache 日志
tail -f /var/log/nginx/error.log
```

#### 4.3 监控性能
```bash
# 检查数据库表大小变化
psql -U your_db_user -d examdb -c "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename IN ('contracts', 'contract_signatures')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

---

### 第五步：回滚方案（如果出现问题）

#### 5.1 停止服务
```bash
sudo systemctl stop examdb-web
sudo systemctl stop examdb-celery
```

#### 5.2 恢复数据库
```bash
# 恢复备份
psql -U your_db_user -d examdb < /backup/examdb_backup_YYYYMMDD_HHMMSS.sql
```

#### 5.3 回滚代码
```bash
cd /path/to/examdb
git checkout <previous-commit-hash>
```

#### 5.4 重启服务
```bash
sudo systemctl start examdb-web
sudo systemctl start examdb-celery
```

---

## 升级检查清单

### 升级前
- [ ] 完整备份生产数据库
- [ ] 检查现有签名数据量
- [ ] 创建签名存储目录
- [ ] 在测试环境完整测试升级流程
- [ ] 通知用户维护窗口

### 升级中
- [ ] 停止所有服务
- [ ] 拉取最新代码
- [ ] 执行签名数据迁移脚本
- [ ] 执行数据库迁移
- [ ] 验证数据迁移结果
- [ ] 构建前端
- [ ] 重启服务

### 升级后
- [ ] 测试查看现有合同
- [ ] 测试创建新合同
- [ ] 测试签署合同
- [ ] 测试下载 PDF
- [ ] 检查应用日志
- [ ] 监控性能指标
- [ ] 确认数据库表大小减小

---

## 常见问题

### Q1: 如果签名迁移脚本执行失败怎么办？
**A**: 脚本设计为事务性的，单个合同失败不会影响其他合同。检查错误日志，修复问题后重新运行脚本（已迁移的会自动跳过）。

### Q2: 升级后旧的签名数据会丢失吗？
**A**: 不会。迁移脚本只是将 base64 数据转换为文件，数据库迁移会在确认后才删除旧字段。

### Q3: 如何验证所有签名都成功迁移？
**A**: 运行以下 SQL 查询：
```sql
-- 应该返回 0
SELECT COUNT(*) FROM contracts 
WHERE customer_signature IS NOT NULL 
  AND id NOT IN (SELECT contract_id FROM contract_signatures WHERE signature_type = 'customer');
```

### Q4: 签名文件占用多少磁盘空间？
**A**: 每个签名约 5-50KB，根据您的合同数量估算。建议预留至少 100MB 空间。

---

## 联系支持
如果升级过程中遇到问题，请保留：
1. 错误日志
2. 数据库备份
3. 迁移脚本输出

立即联系技术支持团队。
