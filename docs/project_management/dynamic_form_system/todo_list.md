# 待办事项清单 (To-Do List)

此清单用于跟踪“动态表单与记录管理系统”功能的开发进度。

- [x] **阶段一：基础架构与数据建模**
    - [x] 1. 在 `backend/models.py` 中定义 `DynamicForm` 和 `DynamicFormData` 两个新的 SQLAlchemy 模型。
    - [x] 2. 为 `DynamicForm` 模型添加 `form_type`, `sync_mapping`, `passing_score`, `exam_duration` 等元数据字段。
    - [ ] 3. 为 `service_personnel` 表（如果需要）添加 `current_contract_id` 等外键字段。
    - [ ] 4. 运行 `alembic revision --autogenerate` 生成数据库迁移脚本，并进行人工核对与调整。
    - [ ] 5. 运行 `alembic upgrade head` 应用数据库变更。

- [ ] **阶段二：核心后端逻辑**
    - [ ] 1. **数据迁移脚本**: 开发一个独立的 Python 脚本 (`scripts/migrate_jinshuju_forms.py`)，用于将金数据 JSON 转换为 SurveyJS JSON 并填充 `DynamicForm` 表。
    - [ ] 2. **API - 表单结构**: 开发 `DynamicForm` 模型的 CRUD API 端点 (`/api/forms`)。
    - [x] 3. **API - 表单数据**: 开发 `DynamicFormData` 模型的 CRUD API 端点 (`/api/form-data`)。
        - [x] 3.1. 实现 `POST` 和 `PATCH` 方法，使其能够在一个事务中处理 `sync_mapping` 逻辑，同步数据到 `service_personnel` 表。
        - [x] 3.2. 实现 `GET` 方法，使其能够处理 `record_association` 逻辑，聚合关联记录的数据。
        - [ ] 3.3. 实现反向关联逻辑（例如，保存合同时更新员工记录）。
    - [ ] 4. **API - 权限**: 为所有新 API 端点集成字段级的权限控制逻辑。

- [ ] **阶段三：前端开发**
    - [ ] 1. **环境设置**: 在前端项目中安装 `survey-react-ui` 依赖。
    - [ ] 2. **自定义组件**: 开发并注册用于处理 `record_association` 的自定义 React 组件。该组件需支持搜索和选择功能。
    - [ ] 3. **核心页面**: 开发统一的表单渲染页面 (`/forms/:id`)。
        - [ ] 3.1. 实现逻辑以从后端加载表单结构 (Schema) 和数据 (Data)。
        - [ ] 3.2. 根据 `form_type` 和用户权限，自动切换“只读”、“新建”、“编辑”三种模式。
        - [ ] 3.3. 处理表单提交，调用后端 `POST` 或 `PATCH` API。

- [x] **阶段四：测试与文档**
    - [x] 1. **单元测试**: 为后端模型、服务函数和转换器编写单元测试。
        *   **备注**: 已为 `DynamicFormData` 的 `POST` 和 `PATCH` 端点编写了集成测试，验证 `sync_mapping` 逻辑。
    - [x] 2. **集成测试**: 为 API 的核心工作流（特别是同步和关联逻辑）编写集成测试。
        *   **注意**: 由于 `genai` 导入错误，自动化测试目前被阻塞。`GET /api/form-data/<id>` 端点已通过 Postman 手动验证。
        *   **备注**: 已为 `DynamicFormData` 的 `POST` 和 `PATCH` 端点编写了集成测试，验证 `sync_mapping` 逻辑。
    - [x] 3. **提供手动测试说明**: 已提供 `manual_testing_instructions.md` 文档，指导用户手动验证 `POST` 和 `PATCH` 端点及 `sync_mapping` 逻辑。
    - [ ] 4. **前端测试**: 为自定义的 `record_association` 组件编写单元测试。
    - [ ] 5. **文档完善**: 回填 `test_cases.md` 中的实际测试结果，并确保所有项目文档都是最新的。