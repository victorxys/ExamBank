# 合同数据优化需求文档

## 1. 引言

本文档旨在明确对 `contracts` 表中大字段进行优化的需求，以解决 Navicat 等数据库管理工具访问缓慢以及数据库存储效率低下的问题。特别是针对 `template_content`、`customer_signature` 和 `employee_signature` 字段。

## 2. 目标

*   提高数据库查询 `contracts` 表的性能，改善数据库管理工具（如 Navicat）的用户体验。
*   优化数据库存储，减少 `contracts` 表的物理大小。
*   遵循数据存储的最佳实践，将大对象（BLOB/TEXT）从主表中分离。

## 3. 范围

本次优化将涉及 `backend/models.py` 中 `BaseContract` 模型及其相关联的数据存储和访问逻辑。

## 4. 详细需求

### 4.1. 移除 `BaseContract.template_content` 字段

**功能描述：**
`BaseContract` 模型中的 `template_content` 字段将从数据库中移除。合同模板内容将完全依赖于 `template_id` 关联的 `ContractTemplate` 模型来获取。

**用户场景：**
*   用户查看合同详情时，合同模板内容将通过 `contract.template.content` 获取。
*   由于合同模板一旦被合同关联就无法覆盖保存，只能另存为新版本，因此 `template_id` 已经提供了“合同快照”的功能，`template_content` 字段是冗余的。

**关键约束：**
*   确保移除字段后，所有依赖 `contract.template_content` 的现有代码逻辑能够正确迁移到 `contract.template.content`。
*   数据库迁移过程必须安全，不丢失现有数据（尽管 `template_content` 是冗余的，但仍需确保平稳过渡）。

### 4.2. 外部化 `customer_signature` 和 `employee_signature` 字段

**功能描述：**
`BaseContract` 模型中的 `customer_signature` 和 `employee_signature` 字段将从数据库中移除。签名图片将不再以 base64 编码的形式直接存储在 `contracts` 表中，而是存储为独立的文件，并在数据库中记录其文件路径。

**用户场景：**
*   用户查看合同详情时，签名图片将通过文件路径加载显示。
*   用户签署合同时，签名图片将上传到文件存储，并将文件路径保存到数据库。

**关键约束：**
*   需要设计并实现签名图片的文件存储方案（例如，存储在本地文件系统或对象存储服务）。
*   需要创建一个新的模型（例如 `ContractSignature`）来存储签名相关的元数据（如文件路径、签名类型、签名时间、签名人等），并通过外键与 `BaseContract` 关联。
*   确保现有签名数据的迁移（如果存在）和新签名数据的存储、检索逻辑正确无误。
*   数据库迁移过程必须安全，不丢失现有签名数据。

## 5. 非功能性要求

*   **性能：** 优化后，`contracts` 表的查询速度应显著提升。
*   **可维护性：** 代码结构应清晰，易于理解和维护。
*   **安全性：** 签名文件的存储和访问应确保安全。
*   **兼容性：** 尽量减少对现有 API 和前端界面的影响，或提供明确的迁移路径。

## 6. 验收标准

*   `contracts` 表中不再包含 `template_content`、`customer_signature` 和 `employee_signature` 列。
*   所有依赖这些字段的业务逻辑能够正常运行。
*   签名图片能够正确上传、存储和显示。
*   数据库查询 `contracts` 表的性能得到明显改善。
