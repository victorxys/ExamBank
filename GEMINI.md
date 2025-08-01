# Gemini 自定义指令

## 关于本项目

这是一个全栈Web应用程序，项目名为 "examdb"。

*   **后端**: 使用 Python, Flask, SQLAlchemy 和 Celery。
*   **前端**: 使用 JavaScript, React 和 Vite。
*   **数据库**: 使用了 Alembic 进行数据库迁移。
*   **包管理**: 后端使用 `pip` 和 `requirements.txt`，前端使用 `npm`。

## 编码规范

*   **后端**:
    *   遵循 PEP 8 风格指南。
    *   使用 Ruff进行代码格式化和 linting。
*   **前端**:
    *   遵循项目配置的 ESLint 规则。
*   **通用**:
    *   Commit messages 请遵循 Conventional Commits 规范。
    *   所有代码和注释都应使用中文。

## 常用命令

*   **后端**:
    *   激活虚拟环境: `source venv/bin/activate`
    *   安装依赖: `pip install -r backend/requirements.txt`
    *   启动开发服务器: `flask run`
    *   运行测试: `pytest backend/tests`
    *   运行 linter: `ruff check backend`
    *   格式化代码: `ruff format backend`
*   **前端**:
    *   安装依赖: `cd frontend && npm install`
    *   启动开发服务器: `cd frontend && npm run dev`
    *   构建生产版本: `cd frontend && npm run build`
    *   运行 linter: `cd frontend && npm run lint`

## Gemini 交互指南

*   在修改代码前，请先理解相关模块的上下文。
*   在你修改或替换代码的时候，不要企图批量替换，请先将要修改的文件读入内存，在内存中修改后再写回原文件。
*   优先编写或更新测试。
*   遵循现有的代码风格和项目结构。
*   若不确定，请向我提问。
*   在运行任何终端命令前，请先”激活虚拟环境“！！！
