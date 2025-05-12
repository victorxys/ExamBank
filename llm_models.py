# backend/models/llm_models.py
import uuid
from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from ..database import db # 假设你的 db 实例在 backend/database.py

# 假设你有一个 User 模型，如果放在不同文件，需要正确导入
# from .user import User # 示例导入，根据你的项目结构调整

class LlmModel(db.Model):
    __tablename__ = "llm_models"

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_name = db.Column(db.String, unique=True, nullable=False)
    provider = db.Column(db.String, nullable=False) # e.g., "Google Gemini", 
"OpenAI"
    description = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, 
onupdate=datetime.utcnow)

    prompts = db.relationship("LlmPrompt", back_populates="model")

    def __repr__(self):
        return f"<LlmModel {self.model_name}>"

class LlmApiKey(db.Model):
    __tablename__ = "llm_api_keys"

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_name = db.Column(db.String, unique=True, nullable=False)
    api_key_encrypted = db.Column(db.Text, nullable=False) # Stores encrypted key
    provider = db.Column(db.String, nullable=False) # Should match a provider in 
LlmModel
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, 
onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<LlmApiKey {self.key_name}>"

class LlmPrompt(db.Model):
    __tablename__ = "llm_prompts"

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prompt_name = db.Column(db.String, unique=True, nullable=False) # Business 
identifier
    system_instruction = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text, nullable=True)
    model_id = db.Column(UUID(as_uuid=True), db.ForeignKey("llm_models.id"), 
nullable=True)
    version = db.Column(db.Integer, default=1, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, 
onupdate=datetime.utcnow)

    model = db.relationship("LlmModel", back_populates="prompts")

    def __repr__(self):
        return f"<LlmPrompt {self.prompt_name} v{self.version}>"

class LlmLog(db.Model):
    __tablename__ = "llm_logs"

    id = db.Column(db.BigInteger, primary_key=True) # BigSerial equivalent
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    calling_function = db.Column(db.String, nullable=False)
    prompt_name_used = db.Column(db.String, nullable=True)
    model_name_used = db.Column(db.String, nullable=False)
    api_key_name_used = db.Column(db.String, nullable=True)
    input_data = db.Column(JSONB, nullable=True) # Or db.Text if JSONB is not 
always suitable
    output_raw = db.Column(db.Text, nullable=True)
    output_parsed = db.Column(JSONB, nullable=True)
    success = db.Column(db.Boolean, nullable=False)
    error_message = db.Column(db.Text, nullable=True)
    duration_ms = db.Column(db.Integer, nullable=True)
    
    # ForeignKey to your User model. Adjust "user.id" if your table/column names 
are different.
    # Make sure your User model is imported or defined accessible here.
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey("user.id"), 
nullable=True) 
    user = db.relationship("User") # Assumes a User model with 'id' as primary key

    context_id = db.Column(db.String, nullable=True) # e.g., evaluation_id

    def __repr__(self):
        return f"<LlmLog {self.id} - {self.calling_function} - {'Success' if 
self.success else 'Failure'}>"
