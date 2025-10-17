# backend/models.py
from flask import current_app, url_for
import uuid
import enum
from sqlalchemy import Enum as SAEnum
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB as PG_JSONB, ARRAY
from sqlalchemy import (
    func,
    UniqueConstraint,
    CheckConstraint,
    Index,
    ForeignKeyConstraint,
    PrimaryKeyConstraint,
)
from sqlalchemy.orm import backref
from datetime import datetime
from .extensions import db

# --- Association Tables (Defined using db.Table) ---
exampapercourse_table = db.Table(
    "exampapercourse",
    db.metadata,
    db.Column(
        "exam_paper_id",
        PG_UUID(as_uuid=True),
        db.ForeignKey("exampaper.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    db.Column(
        "course_id",
        PG_UUID(as_uuid=True),
        db.ForeignKey("trainingcourse.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    schema="public",
)

# --- Model Classes (Inheriting from db.Model) ---


class AlembicVersion(db.Model):
    __tablename__ = "alembic_version"
    version_num = db.Column(db.String(32), primary_key=True, nullable=False)


class TrainingCourse(db.Model):
    __tablename__ = "trainingcourse"
    __table_args__ = {"comment": "培训课程表，存储课程的基本信息"}

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="主键，使用 UUID，自动生成",
    )
    course_name = db.Column(
        db.String(255), nullable=False, comment="课程名称，不允许为空"
    )
    age_group = db.Column(
        db.String(50), nullable=True, comment='适用月龄 (例如："2-3个月", "3-4个月")'
    )
    description = db.Column(db.Text, nullable=True, comment="课程描述，可为空")
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        comment="创建时间，带时区的时间戳，默认值为当前时间",
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间，带时区的时间戳，默认值为当前时间",
    )

    knowledge_points = db.relationship(
        "KnowledgePoint", backref="course", lazy="dynamic", cascade="all, delete-orphan"
    )
    exam_papers = db.relationship(
        "ExamPaper",
        secondary=exampapercourse_table,
        back_populates="courses",
        lazy="dynamic",
    )
    # training_contents 关系将由 TrainingContent 模型中通过 backref='course' 定义
    course_resources = db.relationship(
        "CourseResource",
        backref="course",
        lazy="dynamic",
        cascade="all, delete-orphan",
        order_by="CourseResource.sort_order",
    )

    def __repr__(self):
        return f"<TrainingCourse {self.course_name}>"


class KnowledgePoint(db.Model):
    __tablename__ = "knowledgepoint"
    __table_args__ = (
        ForeignKeyConstraint(
            ["course_id"],
            ["trainingcourse.id"],
            ondelete="CASCADE",
            name="knowledgepoint_course_id_fkey",
        ),
        {"comment": "知识点表, 存储各个课程下的知识点"},
    )

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    course_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("trainingcourse.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到 TrainingCourse 表",
    )
    point_name = db.Column(db.String(255), nullable=False, comment="知识点名称")
    description = db.Column(db.Text, nullable=True, comment="知识点描述")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    questions = db.relationship(
        "Question",
        backref="knowledge_point",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<KnowledgePoint {self.point_name}>"


class Question(db.Model):
    __tablename__ = "question"
    __table_args__ = (
        ForeignKeyConstraint(
            ["knowledge_point_id"],
            ["knowledgepoint.id"],
            ondelete="CASCADE",
            name="question_knowledge_point_id_fkey",
        ),
        {"comment": "题目表，存储题库中的题目"},
    )

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    knowledge_point_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("knowledgepoint.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到 KnowledgePoint 表",
    )
    question_type = db.Column(
        db.String(50), nullable=False, comment='题目类型 (例如："单选", "多选", "问答")'
    )
    question_text = db.Column(db.Text, nullable=False, comment="题干")
    difficulty = db.Column(db.Integer, nullable=True, comment="题目难度 1-5")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    options = db.relationship(
        "Option",
        backref="question",
        lazy="dynamic",
        cascade="all, delete-orphan",
        order_by="Option.id",
    )
    answer = db.relationship(
        "Answer", backref="question", uselist=False, cascade="all, delete-orphan"
    )
    exam_paper_associations = db.relationship(
        "ExamPaperQuestion",
        back_populates="question",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    answer_records = db.relationship("AnswerRecord", backref="question", lazy="dynamic")
    temp_answers = db.relationship(
        "TempAnswerRecord", backref="question", lazy="dynamic"
    )

    def __repr__(self):
        return f"<Question {self.id} ({self.question_type})>"


class Option(db.Model):
    __tablename__ = "option"
    __table_args__ = (
        ForeignKeyConstraint(
            ["question_id"],
            ["question.id"],
            ondelete="CASCADE",
            name="option_question_id_fkey",
        ),
        {"comment": "选项表，存储题目的选项"},
    )

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    question_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("question.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到 Question 表",
    )
    option_text = db.Column(db.Text, nullable=False, comment="选项文本")
    is_correct = db.Column(
        db.Boolean,
        default=False,
        nullable=False,
        server_default="false",
        comment="是否为正确答案",
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    def __repr__(self):
        return f"<Option {self.id} for Q {self.question_id}>"


class Answer(db.Model):
    __tablename__ = "answer"
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    question_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("question.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        comment="外键，关联到 Question 表，一对一关系",
    )
    answer_text = db.Column(db.Text, nullable=True, comment="参考答案文本 (对于问答题)")
    explanation = db.Column(db.Text, nullable=True, comment="答案解析")
    source = db.Column(db.Text, nullable=True, comment="答案出处")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    def __repr__(self):
        return f"<Answer for Q {self.question_id}>"


class ExamPaper(db.Model):
    __tablename__ = "exampaper"
    __table_args__ = {"comment": "试卷表，存储试卷的基本信息"}

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    title = db.Column(db.String(255), nullable=False, comment="试卷标题")
    description = db.Column(db.Text, nullable=True, comment="试卷描述")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    courses = db.relationship(
        "TrainingCourse",
        secondary=exampapercourse_table,
        back_populates="exam_papers",
        lazy="dynamic",
    )
    question_associations = db.relationship(
        "ExamPaperQuestion",
        back_populates="exam_paper",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    exams = db.relationship("Exam", backref="exam_paper", lazy="dynamic")
    answer_records = db.relationship(
        "AnswerRecord",
        backref="exam_paper",
        lazy="dynamic",
        foreign_keys="AnswerRecord.exam_paper_id",
    )
    temp_answers = db.relationship(
        "TempAnswerRecord", backref="exam_paper", lazy="dynamic"
    )

    def __repr__(self):
        return f"<ExamPaper {self.title}>"


class ExamPaperQuestion(db.Model):
    __tablename__ = "exampaperquestion"
    __table_args__ = (
        UniqueConstraint(
            "exam_paper_id",
            "question_id",
            name="exampaperquestion_exam_paper_id_question_id_key",
        ),
        {"comment": "试卷题目关联表，存储试卷和题目的多对多关系及元数据"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    exam_paper_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("exampaper.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到 ExamPaper 表",
    )
    question_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("question.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到 Question 表",
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    exam_paper = db.relationship("ExamPaper", back_populates="question_associations")
    question = db.relationship("Question", back_populates="exam_paper_associations")

    def __repr__(self):
        return f"<ExamPaperQuestion Link {self.exam_paper_id} <-> {self.question_id}>"


# --- User model definition MUST come BEFORE TrainingContent if TrainingContent directly references User in foreign_keys ---
# --- OR ensure all cross-references use strings for model names in relationships if order is an issue ---
class User(db.Model):
    __tablename__ = "user"
    __table_args__ = (
        UniqueConstraint("phone_number", name="user_phone_number_key"),
        UniqueConstraint("email", name="uq_user_email"),
        {"comment": "用户表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="用户ID"
    )
    username = db.Column(db.String(255), nullable=False, comment="用户名")
    phone_number = db.Column(db.String(20), nullable=False, comment="手机号")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    password = db.Column(db.Text, nullable=False, comment="密码（加密存储）")
    role = db.Column(
        db.String(50),
        nullable=False,
        default="student",
        server_default="student",
        comment="用户角色（admin/teacher/student）",
    )
    email = db.Column(db.String(255), nullable=True, comment="邮箱")
    status = db.Column(
        db.String(50),
        nullable=False,
        default="active",
        server_default="active",
        comment="用户状态（active/inactive）",
    )
    avatar = db.Column(db.String(255), nullable=True, comment="用户头像 URL")
    myms_user_id = db.Column(
        db.BigInteger, nullable=True, comment="关联到另一个数据库中用户的 ID"
    )
    name_pinyin = db.Column(
        db.String(255), index=True, comment="姓名拼音，用于模糊搜索"
    )

    profile = db.relationship(
        "UserProfile", backref="user", uselist=False, cascade="all, delete-orphan"
    )
    exams_taken = db.relationship(
        "Exam", backref="user", lazy="dynamic", foreign_keys="Exam.user_id"
    )
    answer_records = db.relationship(
        "AnswerRecord",
        backref="user",
        lazy="dynamic",
        foreign_keys="AnswerRecord.user_id",
    )
    temp_answers = db.relationship(
        "TempAnswerRecord",
        backref="user",
        lazy="dynamic",
        foreign_keys="TempAnswerRecord.user_id",
    )
    evaluations_received = db.relationship(
        "Evaluation",
        backref="evaluated_user",
        lazy="dynamic",
        foreign_keys="Evaluation.evaluated_user_id",
    )
    evaluations_given = db.relationship(
        "Evaluation",
        backref="evaluator_user",
        lazy="dynamic",
        foreign_keys="Evaluation.evaluator_user_id",
    )
    llm_call_logs = db.relationship("LlmCallLog", backref="user_ref", lazy="dynamic")
    # REMOVED: tts_uploaded_contents relationship, it's handled by TrainingContent.uploader's backref
    uploaded_course_resources = db.relationship(
        "CourseResource",
        backref="uploader",
        lazy="dynamic",
        foreign_keys="CourseResource.uploaded_by_user_id",
    )
    resource_play_logs = db.relationship(
        "UserResourcePlayLog",
        backref="user",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<User {self.username}>"


class TrainingContent(db.Model):
    __tablename__ = "training_content"
    __table_args__ = {"comment": "课程培训内容表"}

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="培训内容唯一标识",
    )
    course_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("trainingcourse.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属课程ID",
    )
    content_name = db.Column(db.String(255), nullable=False, comment="培训内容名称")
    original_content = db.Column(
        db.Text, nullable=False, comment="用户上传的原始培训内容文本"
    )
    status = db.Column(
        db.String(50),
        nullable=False,
        default="pending",
        index=True,
        comment="处理状态 (pending, oral_processing, tts_refining, llm_refining, splitting, audio_generating, merging, completed, error)",
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    uploaded_by_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="上传用户ID",
    )
    llm_oral_prompt_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey(
            "llm_prompts.id",
            ondelete="SET NULL",
            name="fk_training_content_oral_prompt",
        ),
        nullable=True,
        comment="口语化处理LLM Prompt ID",
    )  # 添加 name
    llm_refine_prompt_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey(
            "llm_prompts.id",
            ondelete="SET NULL",
            name="fk_training_content_refine_prompt",
        ),
        nullable=True,
        comment="修订refine脚本LLM Prompt ID",
    )  # 添加 name
    default_tts_config = db.Column(
        PG_JSONB,
        nullable=True,
        comment="全局默认的TTS生成配置 (e.g., engine, prompt, temperature)",
    )

    course = db.relationship(
        "TrainingCourse",
        backref=backref(
            "training_contents", lazy="dynamic", cascade="all, delete-orphan"
        ),
    )
    uploader = db.relationship(
        "User", backref=backref("uploaded_training_contents", lazy="dynamic")
    )

    llm_oral_prompt = db.relationship(
        "LlmPrompt",
        foreign_keys=[llm_oral_prompt_id],
        back_populates="training_contents_where_llm_oral_prompt",
    )
    llm_refine_prompt = db.relationship(
        "LlmPrompt",
        foreign_keys=[llm_refine_prompt_id],
        back_populates="training_contents_where_llm_refine_prompt",
    )

    tts_scripts = db.relationship(
        "TtsScript",
        backref="training_content",
        lazy="dynamic",
        cascade="all, delete-orphan",
        order_by="TtsScript.created_at",
    )
    merged_audios = db.relationship(
        "TtsAudio",
        lazy="dynamic",
        cascade="all, delete-orphan",
        primaryjoin="and_(TrainingContent.id==foreign(TtsAudio.training_content_id), TtsAudio.audio_type=='merged_audio')",
        order_by="TtsAudio.created_at.desc()",
    )

    def __repr__(self):
        return f"<TrainingContent {self.content_name} for Course {self.course_id}>"


# --- The rest of the models (Exam, AnswerRecord, TempAnswerRecord, UserProfile, Evaluation System, LLM Management, TTS Module) ---
# --- should follow here, ensuring TrainingContent is defined before it's referenced directly by class name in foreign_keys if not using string notation. ---
# --- However, with the current structure, TrainingContent's relationships are mostly defined using string notation or through backrefs, minimizing order dependency. ---


class Exam(db.Model):
    __tablename__ = "exam"
    __table_args__ = (
        ForeignKeyConstraint(
            ["exam_paper_id"],
            ["exampaper.id"],
            name="exam_exam_paper_id_fkey",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="exam_user_id_fkey", ondelete="RESTRICT"
        ),
        PrimaryKeyConstraint("id", name="exam_pkey"),
        {"comment": "考试表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="考试ID (主键)",
    )
    exam_paper_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("exampaper.id", ondelete="RESTRICT"),
        nullable=False,
        comment="试卷ID，外键关联到 exampaper 表",
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=False,
        comment="用户ID，外键关联到 user 表",
    )
    single_choice_count = db.Column(db.Integer, nullable=False, comment="单选题数量")
    multiple_choice_count = db.Column(db.Integer, nullable=False, comment="多选题数量")
    total_score = db.Column(db.Integer, nullable=False, comment="试卷总分")
    correct_rate = db.Column(db.Numeric(5, 2), nullable=True, comment="正确率")
    knowledge_point_summary = db.Column(
        PG_JSONB, nullable=True, comment="知识点掌握情况 (JSON 数组)"
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    finished = db.Column(db.Boolean, default=False, comment="是否完成考试")

    answer_records = db.relationship(
        "AnswerRecord",
        backref="exam",
        lazy="dynamic",
        foreign_keys="AnswerRecord.exam_id",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Exam {self.id} for User {self.user_id}>"


class AnswerRecord(db.Model):
    __tablename__ = "answerrecord"
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    exam_paper_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("exampaper.id"),
        nullable=False,
        comment="外键，关联到 ExamPaper 表",
    )
    question_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("question.id"),
        nullable=False,
        comment="外键，关联到 Question 表",
    )
    selected_option_ids = db.Column(
        ARRAY(PG_UUID(as_uuid=True)),
        nullable=True,
        comment="用户选择的选项 ID 列表 (用于单选和多选)",
    )
    answer_text = db.Column(db.Text, nullable=True, comment="用户填写的答案 (用于问答)")
    score = db.Column(db.Integer, nullable=True, comment="该题得分")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="答题时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id"),
        nullable=False,
        comment="答题者 ID, 外键, 关联到user表",
    )
    exam_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("exam.id", ondelete="CASCADE"),
        nullable=True,
        comment="考试ID，外键关联到 exam 表",
    )

    def __repr__(self):
        return f"<AnswerRecord {self.id}>"


class TempAnswerRecord(db.Model):
    __tablename__ = "temp_answer_record"
    __table_args__ = (
        Index("idx_temp_answer_record_exam_user", "exam_paper_id", "user_id"),
        Index("idx_temp_answer_record_is_submitted", "is_submitted"),
        ForeignKeyConstraint(
            ["exam_paper_id"],
            ["exampaper.id"],
            name="temp_answer_record_exam_paper_id_fkey",
        ),
        ForeignKeyConstraint(
            ["question_id"], ["question.id"], name="temp_answer_record_question_id_fkey"
        ),
        ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="temp_answer_record_user_id_fkey"
        ),
        {"comment": "临时答题记录表，存储用户的答题进度"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    exam_paper_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("exampaper.id"),
        nullable=False,
        comment="外键，关联到 ExamPaper 表",
    )
    question_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("question.id"),
        nullable=False,
        comment="外键，关联到 Question 表",
    )
    selected_option_ids = db.Column(
        ARRAY(PG_UUID(as_uuid=True)),
        nullable=True,
        comment="用户选择的选项 ID 列表 (用于单选和多选)",
    )
    answer_text = db.Column(db.Text, nullable=True, comment="用户填写的答案 (用于问答)")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="答题时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id"),
        nullable=False,
        comment="答题者 ID, 外键, 关联到user表",
    )
    is_submitted = db.Column(db.Boolean, default=False, comment="是否已提交")

    def __repr__(self):
        return f"<TempAnswerRecord {self.id}>"


class UserProfile(db.Model):
    __tablename__ = "user_profile"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            ondelete="CASCADE",
            name="user_profile_user_id_fkey",
        ),
        Index("idx_user_profile_data", "profile_data", postgresql_using="gin"),
        PrimaryKeyConstraint("user_id", name="user_profile_pkey"),
        {"comment": "用户详细信息表"},
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="CASCADE"),
        primary_key=True,
        comment="用户ID，主键，外键关联到 user 表",
    )
    profile_data = db.Column(
        PG_JSONB, nullable=False, comment="用户详细信息 (JSON 格式)"
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    def __repr__(self):
        return f"<UserProfile for User {self.user_id}>"


# --- Evaluation System Models ---
class Customer(db.Model):
    __tablename__ = "customer"
    __table_args__ = (
        UniqueConstraint("phone_number", name="customer_phone_number_key"),
        {"comment": "客户信息表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="客户ID (主键)",
    )
    first_name = db.Column(db.String(255), nullable=False, comment="客户的姓")
    last_name = db.Column(db.String(255), nullable=True, comment="客户的名")
    title = db.Column(db.String(50), nullable=True, comment="称谓 (先生/女士/小姐等)")
    phone_number = db.Column(db.String(20), nullable=True, comment="联系电话")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    evaluations_given = db.relationship(
        "Evaluation",
        backref="evaluator_customer",
        lazy="dynamic",
        foreign_keys="Evaluation.evaluator_customer_id",
    )

    def __repr__(self):
        return f'<Customer {self.first_name} {self.last_name or ""}>'


class EmployeeSelfEvaluation(db.Model):
    __tablename__ = "employee_self_evaluation"
    __table_args__ = {"comment": "员工自评表"}
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    name = db.Column(db.String(255), nullable=False, comment="评价者姓名")
    phone_number = db.Column(db.String(20), nullable=False, comment="评价者手机号")
    additional_comments = db.Column(db.Text, nullable=True, comment="评价补充说明")
    evaluation_time = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="评价时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    details = db.relationship(
        "EmployeeSelfEvaluationDetail",
        backref="evaluation",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<EmployeeSelfEvaluation {self.id} by {self.name}>"


class EvaluationAspect(db.Model):
    __tablename__ = "evaluation_aspect"
    __table_args__ = (
        Index("idx_evaluation_aspect_sort_order", "sort_order"),
        {"comment": "评价方面表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    aspect_name = db.Column(db.String(255), nullable=False, comment="方面名称")
    description = db.Column(db.Text, nullable=True, comment="方面描述")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    sort_order = db.Column(db.Integer, default=0, nullable=False, server_default="0")

    categories = db.relationship(
        "EvaluationCategory",
        backref="aspect",
        lazy="dynamic",
        cascade="all, delete-orphan",
        order_by="EvaluationCategory.sort_order",
    )

    def __repr__(self):
        return f"<EvaluationAspect {self.id} {self.aspect_name}>"


class EvaluationCategory(db.Model):
    __tablename__ = "evaluation_category"
    __table_args__ = (
        Index(
            "idx_evaluation_category_aspect_id_sort_order", "aspect_id", "sort_order"
        ),
        ForeignKeyConstraint(
            ["aspect_id"],
            ["evaluation_aspect.id"],
            ondelete="CASCADE",
            name="evaluation_category_aspect_id_fkey",
        ),
        {"comment": "评价类别表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    aspect_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation_aspect.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到评价方面表",
    )
    category_name = db.Column(db.String(255), nullable=False, comment="类别名称")
    description = db.Column(db.Text, nullable=True, comment="类别描述")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    sort_order = db.Column(db.Integer, default=0, nullable=False, server_default="0")
    allow_manual_input = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否允许对该类别进行手动文字输入",
    )
    items = db.relationship(
        "EvaluationItem",
        backref="category",
        lazy="dynamic",
        cascade="all, delete-orphan",
        order_by="EvaluationItem.sort_order",
    )

    def __repr__(self):
        return f"<EvaluationCategory {self.id} {self.category_name}>"


class EvaluationItem(db.Model):
    __tablename__ = "evaluation_item"
    __table_args__ = (
        Index(
            "idx_evaluation_item_category_id_sort_order", "category_id", "sort_order"
        ),
        ForeignKeyConstraint(
            ["category_id"],
            ["evaluation_category.id"],
            ondelete="CASCADE",
            name="evaluation_item_category_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="evaluation_item_pkey"),
        {"comment": "评价项表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    category_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation_category.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到评价类别表",
    )
    item_name = db.Column(db.String(255), nullable=False, comment="评价项名称")
    description = db.Column(db.Text, nullable=True, comment="评价项描述")
    is_visible_to_client = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否展示给客户",
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    sort_order = db.Column(db.Integer, default=0, nullable=False, server_default="0")

    def __repr__(self):
        return f"<EvaluationItem {self.id} {self.item_name}>"


class EmployeeSelfEvaluationDetail(db.Model):
    __tablename__ = "employee_self_evaluation_detail"
    __table_args__ = (
        CheckConstraint(
            "score >= 0 AND score <= 100",
            name="employee_self_evaluation_detail_score_check",
        ),
        {"comment": "员工自评详情表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    evaluation_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("employee_self_evaluation.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到员工自评表",
    )
    item_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation_item.id"),
        nullable=False,
        comment="外键，关联到评价项表",
    )
    score = db.Column(db.Integer, nullable=False, comment="评价分数 (0-100)")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )

    item = db.relationship(
        "EvaluationItem", backref=backref("self_evaluation_details", lazy="dynamic")
    )

    def __repr__(self):
        return f"<EmployeeSelfEvaluationDetail {self.id}>"


class Evaluation(db.Model):
    __tablename__ = "evaluation"
    __table_args__ = (
        CheckConstraint(
            "(evaluator_user_id IS NOT NULL AND evaluator_customer_id IS NULL) OR (evaluator_user_id IS NULL AND evaluator_customer_id IS NOT NULL)",
            name="chk_evaluation_evaluator",
        ),
        ForeignKeyConstraint(
            ["evaluator_customer_id"],
            ["customer.id"],
            name="fk_evaluation_evaluator_customer_id",
            ondelete="SET NULL",
        ),
        ForeignKeyConstraint(
            ["evaluator_user_id"],
            ["user.id"],
            name="fk_evaluation_evaluator_user_id",
            ondelete="SET NULL",
        ),
        ForeignKeyConstraint(
            ["evaluated_user_id"], ["user.id"], name="evaluation_evaluated_user_id_fkey"
        ),
        {"comment": "评价表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    evaluated_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id"),
        nullable=False,
        comment="被评价人ID",
    )
    evaluator_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
        comment="评价人ID (内部用户)",
    )
    evaluator_customer_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("customer.id", ondelete="SET NULL"),
        nullable=True,
        comment="评价人ID (客户)",
    )
    evaluation_time = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="评价时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    additional_comments = db.Column(
        db.Text, nullable=True, comment="评价补充说明 (人工填写)"
    )

    details = db.relationship(
        "EvaluationDetail",
        backref="evaluation",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    manual_inputs = db.relationship(
        "EvaluationManualInput",
        backref="evaluation",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        evaluator = (
            f"User {self.evaluator_user_id}"
            if self.evaluator_user_id
            else f"Customer {self.evaluator_customer_id}"
        )
        return (
            f"<Evaluation {self.id} by {evaluator} for User {self.evaluated_user_id}>"
        )


class EvaluationDetail(db.Model):
    __tablename__ = "evaluation_detail"
    __table_args__ = (
        ForeignKeyConstraint(
            ["evaluation_id"],
            ["evaluation.id"],
            ondelete="CASCADE",
            name="evaluation_detail_evaluation_id_fkey",
        ),
        ForeignKeyConstraint(
            ["item_id"], ["evaluation_item.id"], name="evaluation_detail_item_id_fkey"
        ),
        {"comment": "评价详情表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="主键"
    )
    evaluation_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation.id", ondelete="CASCADE"),
        nullable=False,
        comment="外键，关联到评价表",
    )
    item_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation_item.id"),
        nullable=False,
        comment="外键，关联到评价项表",
    )
    score = db.Column(db.Integer, nullable=True, comment="评价分数")
    comment = db.Column(db.Text, nullable=True, comment="评价备注")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )

    item = db.relationship(
        "EvaluationItem", backref=backref("evaluation_details", lazy="dynamic")
    )

    def __repr__(self):
        return f"<EvaluationDetail {self.id} for Eval {self.evaluation_id}>"


class EvaluationManualInput(db.Model):
    __tablename__ = "evaluation_manual_input"
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="手动输入记录ID",
    )
    evaluation_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("evaluation_category.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    manual_input = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", "category_id", name="uq_evaluation_manual_input_eval_cat"
        ),
        {"comment": "评价手动输入表"},
    )

    def __repr__(self):
        return (
            f"<EvaluationManualInput Eval:{self.evaluation_id} Cat:{self.category_id}>"
        )


# --- LLM Management Models ---
class LlmModel(db.Model):
    __tablename__ = "llm_models"
    __table_args__ = (
        UniqueConstraint("model_name", name="uq_llm_model_name"),
        UniqueConstraint("model_identifier", name="uq_llm_model_identifier"),
        {"comment": "大语言模型表"},
    )
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_name = db.Column(db.String(255), nullable=False)
    model_identifier = db.Column(db.String(255), nullable=False)
    provider = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(50), nullable=False, default="active")
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    call_logs = db.relationship(
        "LlmCallLog", backref="llm_model_log_ref", lazy="dynamic"
    )

    def __repr__(self):
        return f"<LlmModel {self.model_name}>"


class LlmApiKey(db.Model):
    __tablename__ = "llm_api_keys"
    __table_args__ = (
        UniqueConstraint("key_name", name="uq_llm_api_key_name"),
        {"comment": "LLM API Key 表"},
    )
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_name = db.Column(db.String(255), nullable=False)
    api_key_encrypted = db.Column(db.Text, nullable=False)
    provider = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(50), nullable=False, default="active")
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self):
        return f"<LlmApiKey {self.key_name}>"


class LlmPrompt(db.Model):
    __tablename__ = "llm_prompts"
    __table_args__ = (
        UniqueConstraint(
            "prompt_identifier", "version", name="uq_llm_prompt_identifier_version"
        ),
        ForeignKeyConstraint(
            ["model_identifier"],
            ["llm_models.model_identifier"],
            name="fk_llm_prompt_model_identifier",
        ),
        {"comment": "提示词模板表"},
    )
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prompt_name = db.Column(db.String(255), nullable=False)
    prompt_identifier = db.Column(db.String(255), nullable=False, index=True)
    prompt_template = db.Column(db.Text, nullable=False)
    model_identifier = db.Column(
        db.String(255), db.ForeignKey("llm_models.model_identifier"), nullable=True
    )
    version = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(50), nullable=False, default="active")
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    llm_model_ref = db.relationship(
        "LlmModel",
        foreign_keys=[model_identifier],
        backref=backref("prompts_associated", lazy="dynamic"),
    )
    call_logs = db.relationship(
        "LlmCallLog", backref="llm_prompt_log_ref", lazy="dynamic"
    )

    training_contents_where_llm_oral_prompt = db.relationship(
        "TrainingContent",
        foreign_keys=[TrainingContent.llm_oral_prompt_id],
        back_populates="llm_oral_prompt",
        lazy="dynamic",
    )

    training_contents_where_llm_refine_prompt = db.relationship(
        "TrainingContent",
        foreign_keys=[TrainingContent.llm_refine_prompt_id],
        back_populates="llm_refine_prompt",
        lazy="dynamic",
    )

    def __repr__(self):
        return f"<LlmPrompt {self.prompt_name} (v{self.version})>"


class LlmCallLog(db.Model):
    __tablename__ = "llm_call_logs"
    __table_args__ = {"comment": "LLM 调用日志表"}
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    timestamp = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="调用开始时间"
    )  # 明确其为开始时间
    function_name = db.Column(db.String(255), nullable=False)
    llm_model_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("llm_models.id", name="fk_llm_call_log_model_id"),
        nullable=True,
    )
    llm_prompt_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("llm_prompts.id", name="fk_llm_call_log_prompt_id"),
        nullable=True,
    )
    api_key_name = db.Column(db.String(255), nullable=True)
    input_data = db.Column(PG_JSONB, nullable=True)
    output_data = db.Column(PG_JSONB, nullable=True)
    parsed_output_data = db.Column(PG_JSONB, nullable=True)
    status = db.Column(
        db.String(50), nullable=False, comment="success, error, pending"
    )  # 增加 pending 状态
    error_message = db.Column(db.Text, nullable=True)
    duration_ms = db.Column(db.Integer, nullable=True)
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", name="fk_llm_call_log_user_id"),
        nullable=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now()
    )  # 可以用这个作为初始记录时间
    updated_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )  # 记录更新时间

    def __repr__(self):
        return f"<LlmCallLog {self.id} for {self.function_name} - {self.status}>"


# --- TTS Module Models ---
class TtsScript(db.Model):
    __tablename__ = "tts_script"
    __table_args__ = (
        UniqueConstraint(
            "training_content_id",
            "script_type",
            "version",
            name="uq_tts_script_content_type_version",
        ),
        {"comment": "TTS脚本表，存储不同处理阶段的脚本"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="脚本唯一标识",
    )
    training_content_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("training_content.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="对应的培训内容ID",
    )
    script_type = db.Column(
        db.String(50),
        nullable=False,
        index=True,
        comment="脚本类型 (oral_script, tts_refined_script, final_tts_script)",
    )
    content = db.Column(db.Text, nullable=False, comment="脚本内容")
    version = db.Column(db.Integer, nullable=False, default=1, comment="脚本版本号")
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    llm_call_log_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("llm_call_logs.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联的LLM调用日志ID",
    )
    source_script_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("tts_script.id", ondelete="SET NULL"),
        nullable=True,
        comment="源脚本ID (例如 final_tts_script 的源是 tts_refined_script)",
    )

    llm_call_log = db.relationship(
        "LlmCallLog", backref=backref("generated_tts_scripts", lazy="dynamic")
    )
    source_script_ref = db.relationship(
        "TtsScript",
        remote_side=[id],
        backref=backref("derived_scripts", lazy="dynamic"),
    )
    tts_sentences = db.relationship(
        "TtsSentence",
        backref="tts_script",
        lazy="dynamic",
        cascade="all, delete-orphan",
        primaryjoin="and_(TtsScript.id==TtsSentence.tts_script_id, TtsScript.script_type=='final_tts_script')",
        order_by="TtsSentence.order_index",
    )

    def __repr__(self):
        return f"<TtsScript {self.script_type} v{self.version} for Content {self.training_content_id}>"


class TtsSentence(db.Model):
    __tablename__ = "tts_sentence"
    __table_args__ = (
        Index("idx_tts_sentence_script_order", "tts_script_id", "order_index"),
        {"comment": "TTS句子表，存储拆分后的句子及语音状态"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="句子唯一标识",
    )
    tts_script_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("tts_script.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="对应的最终TTS脚本ID",
    )
    sentence_text = db.Column(db.Text, nullable=False, comment="句子文本")
    order_index = db.Column(db.Integer, nullable=False, comment="句子在脚本中的顺序")
    audio_status = db.Column(
        db.String(50),
        nullable=False,
        default="pending",
        index=True,
        comment="语音生成状态 (pending, generating, completed, error)",
    )
    modified_after_merge = db.Column(
        db.Boolean,
        default=False,
        nullable=False,
        server_default="false",
        comment="在最新一次合并后是否被修改",
    )
    tts_config = db.Column(
        PG_JSONB, nullable=True, comment="针对该单句的特定TTS生成配置，覆盖全局配置"
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    audios = db.relationship(
        "TtsAudio",
        back_populates="tts_sentence",  # <--- 指向 TtsAudio.tts_sentence
        lazy="dynamic",
        cascade="all, delete-orphan",
        # 确保 primaryjoin 正确定义了你想要的过滤条件
        primaryjoin="and_(TtsSentence.id==TtsAudio.tts_sentence_id, TtsAudio.audio_type=='sentence_audio')",
        order_by="TtsAudio.created_at.desc()",
    )

    def __repr__(self):
        return f"<TtsSentence Order {self.order_index} for Script {self.tts_script_id}>"


class TtsAudio(db.Model):
    __tablename__ = "tts_audio"
    __table_args__ = (
        Index(
            "idx_tts_audio_sentence_latest", "tts_sentence_id", "is_latest_for_sentence"
        ),
        Index(
            "idx_tts_audio_content_latest",
            "training_content_id",
            "is_latest_for_content",
        ),
        {"comment": "TTS语音文件表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="语音文件唯一标识",
    )
    tts_sentence_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("tts_sentence.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="对应的句子ID (单句语音)",
    )
    training_content_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("training_content.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="对应的培训内容ID (合并语音)",
    )
    audio_type = db.Column(
        db.String(50),
        nullable=False,
        index=True,
        comment="语音类型 (sentence_audio, merged_audio)",
    )
    file_path = db.Column(db.String(512), nullable=False, comment="语音文件存储路径")
    duration_ms = db.Column(db.Integer, nullable=True, comment="语音时长 (毫秒)")
    file_size_bytes = db.Column(db.Integer, nullable=True, comment="文件大小 (字节)")
    tts_engine = db.Column(db.String(100), nullable=True, comment="使用的TTS引擎")
    voice_name = db.Column(db.String(100), nullable=True, comment="使用的语音名称")
    generation_params = db.Column(
        PG_JSONB, nullable=True, comment="生成语音时使用的参数 (JSONB)"
    )
    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )
    version = db.Column(
        db.Integer,
        nullable=False,
        default=1,
        comment="语音版本号 (例如，对同一句子重新生成)",
    )
    is_latest_for_sentence = db.Column(
        db.Boolean,
        default=True,
        nullable=True,
        comment="是否是对应句子的最新版本语音 (用于单句语音)",
    )
    is_latest_for_content = db.Column(
        db.Boolean,
        default=True,
        nullable=True,
        comment="是否是对应培训内容的最新合并语音 (用于合并语音)",
    )

    # tts_sentence = db.relationship('TtsSentence', backref=backref('all_audios', lazy='dynamic'))
    tts_sentence = db.relationship(
        "TtsSentence",
        back_populates="audios",  # <--- 对应 TtsSentence.audios
        foreign_keys=[tts_sentence_id],
    )

    def __repr__(self):
        if self.tts_sentence_id:
            return f"<TtsAudio Sentence {self.tts_sentence_id} v{self.version}>"
        elif self.training_content_id:
            return f"<TtsAudio Merged for Content {self.training_content_id} v{self.version}>"
        return f"<TtsAudio {self.id}>"


class MergedAudioSegment(db.Model):
    __tablename__ = "merged_audio_segment"
    __table_args__ = (
        db.Index(
            "idx_merged_audio_segment_audio_order",
            "merged_audio_id",
            "original_order_index",
        ),
        {
            "comment": "Segments of a merged TTS audio, mapping to original sentences and their timings."
        },
    )
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # FK to the merged TtsAudio record (the one with audio_type='merged_audio')
    merged_audio_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("tts_audio.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # FK to the original TtsSentence (can be null if the original sentence was deleted after merging)
    tts_sentence_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("tts_sentence.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    original_order_index = db.Column(
        db.Integer,
        nullable=False,
        comment="The order_index of the sentence in its original TtsScript at the time of merging",
    )
    # Store a copy of the text for reference, as sentence text might change later
    original_sentence_text_ref = db.Column(
        db.Text, nullable=True, comment="Sentence text at the time of merging"
    )
    start_ms = db.Column(
        db.Integer,
        nullable=False,
        comment="Start time of this segment in the merged audio (milliseconds)",
    )
    end_ms = db.Column(
        db.Integer,
        nullable=False,
        comment="End time of this segment in the merged audio (milliseconds)",
    )
    duration_ms = db.Column(
        db.Integer,
        nullable=False,
        comment="Duration of this segment in milliseconds (calculated as end_ms - start_ms)",
    )
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    # Relationship to the TtsAudio entry that represents the merged file
    merged_audio = db.relationship(
        "TtsAudio",
        backref=backref("segments", lazy="dynamic", cascade="all, delete-orphan"),
    )
    # Relationship to the original TtsSentence
    tts_sentence = db.relationship(
        "TtsSentence"  # No complex backref needed on TtsSentence for this
    )

    def __repr__(self):
        return f"<MergedAudioSegment for Audio {self.merged_audio_id}, Order {self.original_order_index}, Time {self.start_ms}-{self.end_ms}>"


class CourseResource(db.Model):
    __tablename__ = "course_resource"
    __table_args__ = (
        # 如果希望 share_slug 在课程内部唯一，而不是全局唯一，可以使用下面的约束
        # db.UniqueConstraint('course_id', 'share_slug', name='uq_course_resource_course_slug'),
        {"comment": "课程的媒体和文档资源表"}
    )

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="资源ID"
    )
    name = db.Column(db.String(255), nullable=False, comment="资源原始文件名或显示名称")
    description = db.Column(db.Text, nullable=True, comment="资源描述")
    file_path = db.Column(
        db.String(1024), nullable=False, comment="文件在服务器上的存储路径或云存储的key"
    )
    file_type = db.Column(
        db.String(50), nullable=False, comment="文件主类型 (video, audio, document)"
    )
    mime_type = db.Column(
        db.String(100), nullable=True, comment="MIME类型 (e.g., video/mp4)"
    )
    size_bytes = db.Column(db.BigInteger, nullable=True, comment="文件大小 (字节)")
    duration_seconds = db.Column(db.Float, nullable=True, comment="音视频时长 (秒)")
    course_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey(
            "trainingcourse.id", name="fk_courseresource_course_id", ondelete="CASCADE"
        ),
        nullable=False,
        index=True,
        comment="所属课程ID",
    )
    uploaded_by_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey(
            "user.id", name="fk_courseresource_uploader_id", ondelete="SET NULL"
        ),
        nullable=True,
        index=True,
        comment="上传用户ID",
    )

    play_count = db.Column(
        db.Integer, default=0, nullable=False, server_default="0", comment="播放次数"
    )
    sort_order = db.Column(
        db.Integer,
        default=0,
        nullable=False,
        server_default="0",
        comment="资源在课程内的显示顺序",
    )

    created_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间",
    )

    # # +++++ 新增字段 +++++
    # share_slug = db.Column(db.String(128), nullable=True, unique=True, index=True, comment='固定分享链接的唯一标识符 (slug)')
    # is_latest_for_slug = db.Column(db.Boolean, default=False, nullable=False, server_default='false', comment='是否是此 share_slug 的最新版本')
    # # +++++++++++++++++++++

    # Relationships (保持不变)
    # course = db.relationship('TrainingCourse', back_populates='course_resources')
    # uploader = db.relationship('User', back_populates='uploaded_course_resources')

    def __repr__(self):
        return f"<CourseResource {self.name}>"

    def to_dict(self, include_uploader=False):
        data = {
            "id": str(self.id),
            "course_id": str(self.course_id),
            "name": self.name,
            "description": self.description,
            "file_path": self.file_path,
            "file_type": self.file_type,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "duration_seconds": self.duration_seconds,
            "play_count": self.play_count,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "uploaded_by_user_id": str(self.uploaded_by_user_id)
            if self.uploaded_by_user_id
            else None,
            # 'share_slug': self.share_slug,                  # <-- 新增
            # 'is_latest_for_slug': self.is_latest_for_slug   # <-- 新增
        }
        if include_uploader and self.uploader:
            data["uploader_name"] = self.uploader.username
        return data


class UserResourcePlayLog(db.Model):
    __tablename__ = "user_resource_play_log"  # 新表名
    __table_args__ = (
        db.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name="fk_userresourceplaylog_user_id",
            ondelete="CASCADE",
        ),
        db.ForeignKeyConstraint(
            ["resource_id"],
            ["course_resource.id"],
            name="fk_userresourceplaylog_resource_id",
            ondelete="CASCADE",
        ),
        {"comment": "用户资源播放日志表"},
    )
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment="日志ID"
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True), nullable=False, index=True, comment="用户ID"
    )
    resource_id = db.Column(
        PG_UUID(as_uuid=True), nullable=False, index=True, comment="资源ID"
    )
    played_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="播放时间"
    )
    watch_time_seconds = db.Column(
        db.Integer, nullable=True, comment="本次观看时长 (秒)"
    )
    percentage_watched = db.Column(db.Float, nullable=True, comment="本次观看百分比")
    session_id = db.Column(
        db.String(100), nullable=True, index=True, comment="播放会话ID"
    )
    event_type = db.Column(
        db.String(50),
        nullable=True,
        comment="事件类型 (e.g., session_start, heartbeat, session_end)",
    )

    # Relationships
    # user = db.relationship('User', back_populates='resource_play_logs') # 在 User 中定义
    # resource = db.relationship('CourseResource', back_populates='play_logs') # 在 CourseResource 中定义

    def __repr__(self):
        return f"<UserResourcePlayLog User:{self.user_id} Resource:{self.resource_id}>"

    def to_dict(self):
        return {
            "id": str(self.id),
            "user_id": str(self.user_id),
            "resource_id": str(self.resource_id),
            "played_at": self.played_at.isoformat() if self.played_at else None,
            "watch_time_seconds": self.watch_time_seconds,
            "percentage_watched": self.percentage_watched,
            "session_id": self.session_id,
            "event_type": self.event_type,
        }


class UserCourseAccess(db.Model):
    __tablename__ = "user_course_access"
    __table_args__ = (
        db.PrimaryKeyConstraint("user_id", "course_id", name="pk_user_course_access"),
        db.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name="fk_usercourseaccess_user_id",
            ondelete="CASCADE",
        ),
        db.ForeignKeyConstraint(
            ["course_id"],
            ["trainingcourse.id"],
            name="fk_usercourseaccess_course_id",
            ondelete="CASCADE",
        ),
        {"comment": "用户课程访问权限表 (哪些用户可以访问哪些课程)"},
    )
    user_id = db.Column(PG_UUID(as_uuid=True), nullable=False, comment="用户ID")
    course_id = db.Column(PG_UUID(as_uuid=True), nullable=False, comment="课程ID")
    granted_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="授权时间"
    )

    # Relationships (optional if primarily using association object pattern)
    # user = db.relationship('User', back_populates='course_access_permissions') # 在 User 模型中定义
    # course = db.relationship('TrainingCourse', back_populates='user_access_permissions') # 在 TrainingCourse 模型中定义

    def __repr__(self):
        return f"<UserCourseAccess User:{self.user_id} Course:{self.course_id}>"


class UserResourceAccess(db.Model):
    __tablename__ = "user_resource_access"
    __table_args__ = (
        db.PrimaryKeyConstraint(
            "user_id", "resource_id", name="pk_user_resource_access"
        ),
        db.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name="fk_userresourceaccess_user_id",
            ondelete="CASCADE",
        ),
        db.ForeignKeyConstraint(
            ["resource_id"],
            ["course_resource.id"],
            name="fk_userresourceaccess_resource_id",
            ondelete="CASCADE",
        ),
        {"comment": "用户课程资源访问权限表"},
    )
    user_id = db.Column(PG_UUID(as_uuid=True), nullable=False, comment="用户ID")
    resource_id = db.Column(PG_UUID(as_uuid=True), nullable=False, comment="课程资源ID")
    granted_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), comment="授权时间"
    )

    # +++++ 新增字段 +++++
    expires_at = db.Column(
        db.DateTime(timezone=True), nullable=True, comment="权限过期时间 (NULL表示永久)"
    )
    # +++++++++++++++++++++

    def __repr__(self):
        return f"<UserResourceAccess User:{self.user_id} Resource:{self.resource_id}Expires:{self.expires_at}>"

    # 如果需要，可以在 to_dict 方法中添加 expires_at
    def to_dict(self):
        return {
            "user_id": str(self.user_id),
            "resource_id": str(self.resource_id),
            "granted_at": self.granted_at.isoformat() if self.granted_at else None,
            "expires_at": self.expires_at.isoformat()
            if self.expires_at
            else None,  # 新增
        }


# backend/models.py (新增模型)


class VideoSynthesis(db.Model):
    __tablename__ = "video_synthesis"
    __table_args__ = {"comment": "视频合成任务表"}
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    training_content_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("training_content.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 输入文件
    merged_audio_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("tts_audio.id", ondelete="SET NULL"),
        nullable=True,
    )
    srt_file_path = db.Column(
        db.String(1024), nullable=True, comment="生成的SRT文件路径"
    )
    ppt_pdf_path = db.Column(
        db.String(1024), nullable=False, comment="用户上传的PPT导出的PDF文件路径"
    )

    # PPT 转换为图片后存储的地址
    ppt_image_paths = db.Column(
        PG_JSONB, nullable=True, comment="PDF转换后的图片路径列表 (JSON Array)"
    )

    # LLM 分析
    llm_prompt_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("llm_prompts.id", ondelete="SET NULL"),
        nullable=True,
    )
    video_script_json = db.Column(
        PG_JSONB, nullable=True, comment="LLM生成的视频脚本JSON"
    )

    # 任务状态
    status = db.Column(
        db.String(50),
        nullable=False,
        default="pending_analysis",
        index=True,
        comment="合成状态 (pending_analysis, analysis_complete, synthesizing, complete, error)",
    )

    # 最终产物
    generated_resource_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("course_resource.id", ondelete="SET NULL"),
        nullable=True,
        comment="最终生成的视频资源ID",
    )

    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(
        db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    celery_task_id = db.Column(
        db.String(255), nullable=True, index=True, comment="Celery任务ID"
    )

    training_content = db.relationship(
        "TrainingContent",
        backref=backref(
            "video_syntheses", lazy="dynamic", cascade="all, delete-orphan"
        ),
    )
    # ... 其他关系 ...
    merged_audio = db.relationship("TtsAudio", foreign_keys=[merged_audio_id])
    generated_resource = db.relationship(
        "CourseResource", foreign_keys=[generated_resource_id]
    )


# --- 新增合同管理相关或修改的模型定义 ---


class ServicePersonnel(db.Model):
    __tablename__ = "service_personnel"
    __table_args__ = {"comment": "服务人员表(月嫂/育儿嫂等非系统登录用户)"}

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="主键, UUID",
    )
    name = db.Column(db.String(255), nullable=False, index=True, comment="服务人员姓名")
    name_pinyin = db.Column(
        db.String(255), index=True, comment="姓名拼音，用于模糊搜索"
    )
    phone_number = db.Column(
        db.String(50), nullable=True, unique=True, comment="手机号, 可选但唯一"
    )
    id_card_number = db.Column(db.String(100), nullable=True, comment="身份证号, 可选")
    is_active = db.Column(db.Boolean, default=True, nullable=False, comment="是否在职")

    def __repr__(self):
        return f"<ServicePersonnel {self.name}>"

class TrialOutcome(enum.Enum):
    PENDING = "pending"
    SUCCESS = "success"
    FAILURE = "failure"


class AdjustmentType(enum.Enum):
    CUSTOMER_INCREASE = "customer_increase"  # 客户增款 (收款)
    CUSTOMER_DECREASE = "customer_decrease"  # 客户减款/退款 (付款)
    CUSTOMER_DISCOUNT = "customer_discount"  # 客户优惠
    EMPLOYEE_INCREASE = "employee_increase"  # 员工增款 (付款)
    EMPLOYEE_DECREASE = "employee_decrease"  # 员工减款 (收款, 如交宿舍费)
    EMPLOYEE_CLIENT_PAYMENT = "employee_client_payment" # 【新增】客户直付给员工（公司账目核销）
    EMPLOYEE_COMMISSION = "employee_commission" # 员工佣金/返点 (员工应缴）
    EMPLOYEE_COMMISSION_OFFSET = "employee_commission_offset"   # 冲抵 转移后员工返佣
    DEFERRED_FEE = "deferred_fee"  # 顺延费用
    INTRODUCTION_FEE = "introduction_fee" # 介绍费
    DEPOSIT = "deposit" # 定金
    COMPANY_PAID_SALARY = "company_paid_salary" # 公司代付工资


class CompanyBankAccount(db.Model):
    __tablename__ = 'company_bank_accounts'
    __table_args__ = {'comment': '公司收款账户信息'}

    id = db.Column(db.Integer, primary_key=True)
    account_nickname = db.Column(db.String(100), nullable=False, comment='账户别名，如 \'公司招行主账户\'')
    payee_name = db.Column(db.String(100), nullable=False, comment='收款户名')
    account_number = db.Column(db.String(100), nullable=False, comment='银行账号')
    bank_name = db.Column(db.String(200), nullable=False, comment='开户行全称')
    is_default = db.Column(db.Boolean, nullable=False, default=False, server_default='false', comment='是否为默认账户')
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default='true', comment='是否启用')

    def __repr__(self):
        return f'<CompanyBankAccount {self.account_nickname}>'

class TransactionDirection(enum.Enum):
    CREDIT = "CREDIT"  # 收款/入账
    DEBIT = "DEBIT"    # 付款/出账

class BankTransactionStatus(enum.Enum):
    UNMATCHED = "unmatched"              # 未匹配/未分配
    PARTIALLY_ALLOCATED = "partially_allocated" # 部分分配
    MATCHED = "matched"                  # 完全分配/已匹配
    PENDING_CONFIRMATION = "pending_confirmation" # 待确认 (用于简单一对一匹配建议)
    IGNORED = "ignored"                  # 已忽略
    ERROR = "error"                      # 匹配出错

class BankTransaction(db.Model):
    __tablename__ = 'bank_transactions'
    __table_args__ = (
        db.Index('idx_bank_transactions_associated_object', 'associated_object_type', 'associated_object_id'),
        {'comment': '银行交易流水表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id = db.Column(db.String(255), nullable=True, unique=True, index=True, comment="交易流水号")
    transaction_time = db.Column(db.DateTime(timezone=True), nullable=False, index=True, comment="交易时间")
    amount = db.Column(db.Numeric(12, 2), nullable=False, comment="交易金额")
    payer_name = db.Column(db.String(255), nullable=False, index=True, comment="收(付)方名称")
    summary = db.Column(db.Text, nullable=True, comment="摘要")
    
    transaction_method = db.Column(db.String(100), nullable=True, comment="交易方式")
    currency = db.Column(db.String(20), nullable=True, comment="交易币种")
    business_type = db.Column(db.String(100), nullable=True, comment="业务类型")
    payer_account = db.Column(db.String(255), nullable=True, comment="收(付)方账号")
    direction = db.Column(
        SAEnum(TransactionDirection, name="transactiondirection"),
        nullable=False,
        index=True,
        comment="交易方向 (credit/debit)"
    )
    raw_text = db.Column(db.Text, nullable=True, comment="原始交易行文本")
    
    status = db.Column(
        SAEnum(BankTransactionStatus, name="banktransactionstatus"),
        nullable=False,
        default=BankTransactionStatus.UNMATCHED,
        server_default=BankTransactionStatus.UNMATCHED.value,
        index=True,
        comment="匹配状态"
    )
    ignore_remark = db.Column(db.Text, nullable=True, comment="忽略原因")

    allocated_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0, server_default='0', comment="已被分配的金额")

    # --- Polymorphic Association Fields ---
    associated_object_type = db.Column(db.String(50), nullable=True, comment="关联对象的模型名称 (e.g., 'Contract', 'User', 'ServicePersonnel')")
    associated_object_id = db.Column(PG_UUID(as_uuid=True), nullable=True, comment="关联对象的主键ID")
    # ------------------------------------

    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    payment_records = db.relationship('PaymentRecord', back_populates='bank_transaction', cascade='all, delete-orphan', lazy='dynamic')

    def __repr__(self):
        return f'<BankTransaction {self.id} {self.payer_name} {self.amount}>'

class PayerAlias(db.Model):
    __tablename__ = 'payer_aliases'
    __table_args__ = (
        # 一个付款人可以为多个合同代付，但同一个付款人和同一个合同的组合必须是唯一的
        db.UniqueConstraint('payer_name', 'contract_id', name='uq_payer_name_contract_id'),
        {'comment': '付款人别名表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # 付款人名称，来自银行流水
    payer_name = db.Column(db.String(255), nullable=False, index=True, comment="银行流水中的付款人名称")
    
    # 关联到合同ID
    contract_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('contracts.id', ondelete="CASCADE"), nullable=False, index=True, comment="关联到的合同ID")

    notes = db.Column(db.Text, nullable=True, comment="备注")
    created_by_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete="SET NULL"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    created_by = db.relationship('User')
    contract = db.relationship('BaseContract', backref=db.backref('payer_aliases', lazy='dynamic'))

    def __repr__(self):
        return f'<PayerAlias "{self.payer_name}" -> Contract {self.contract_id}>'

class PayeeAlias(db.Model):
    __tablename__ = 'payee_aliases'
    __table_args__ = (
        db.UniqueConstraint('alias_name', name='uq_payee_aliases_alias_name'),
        {'comment': '收款人别名表（用于代收工资等场景）'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alias_name = db.Column(db.String(255), nullable=False, index=True, comment="银行流水中的收款方名称（代收人）")
    
    # 实际收款人 (员工)
    target_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete="CASCADE"), nullable=True, index=True)
    target_service_personnel_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('service_personnel.id', ondelete="CASCADE"), nullable=True, index=True)

    notes = db.Column(db.Text, nullable=True, comment="备注")
    created_by_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete="SET NULL"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    created_by = db.relationship('User', foreign_keys=[created_by_user_id])
    target_user = db.relationship('User', foreign_keys=[target_user_id])
    target_service_personnel = db.relationship('ServicePersonnel')

    def __repr__(self):
        target = self.target_user.username if self.target_user else (self.target_service_personnel.name if self.target_service_personnel else 'Unknown')
        return f'<PayeeAlias "{self.alias_name}" -> {target}>'


class PermanentIgnoreList(db.Model):
    __tablename__ = 'permanent_ignore_list'
    __table_args__ = (
        db.UniqueConstraint('payer_name', 'direction', name='uq_payer_name_direction'),
        {'comment': '永久忽略名单'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payer_name = db.Column(db.String(255), nullable=False, index=True, comment="要忽略的收/付款方名称")
    direction = db.Column(
        SAEnum(TransactionDirection, name="transactiondirection_permanent_ignore"),
        nullable=False,
        index=True,
        comment="交易方向 (CREDIT/DEBIT)"
    )
    initial_remark = db.Column(db.Text, nullable=True, comment="首次忽略时填写的原始原因")
    created_by_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete="SET NULL"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    created_by = db.relationship('User')

    def __repr__(self):
        return f'<PermanentIgnoreList {self.payer_name} ({self.direction.name})>'

class MonthlyStatement(db.Model):
    __tablename__ = 'monthly_statements'
    __table_args__ = (
        db.UniqueConstraint('customer_name', 'year', 'month', name='uq_customer_name_year_month'),
        {'comment': '月度结算单，用于聚合客户的月度账单'}
    )

    id = db.Column(db.Integer, primary_key=True)
    customer_name = db.Column(db.String(255), nullable=False, index=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    month = db.Column(db.Integer, nullable=False, index=True)
    total_amount = db.Column(db.Numeric(10, 2), nullable=False, server_default='0.00')
    paid_amount = db.Column(db.Numeric(10, 2), nullable=False, server_default='0.00')
    status = db.Column(db.String(20), nullable=False, default='UNPAID', server_default='UNPAID', index=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    bills = db.relationship('CustomerBill', back_populates='statement', lazy='dynamic')

    def __repr__(self):
        return f'<MonthlyStatement {self.id} for {self.customer_name} - {self.year}-{self.month}>'


class FinancialAdjustment(db.Model):
    __tablename__ = "financial_adjustments"
    __table_args__ = {"comment": "财务调整项(增/减款)"}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    adjustment_type = db.Column(SAEnum(AdjustmentType), nullable=False, index=True)
    amount = db.Column(db.Numeric(10, 2), nullable=False, comment="调整金额")
    description = db.Column(db.String(500), nullable=False, comment="款项说明/原因")
    date = db.Column(db.Date, nullable=False, index=True)

    contract_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=True, # 允许为空，因为最终它会属于一个 bill
        index=True,
        comment="关联的合同ID (用于处理未入账的调整项)"
    )

    customer_bill_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("customer_bills.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    employee_payroll_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("employee_payrolls.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    details = db.Column(PG_JSONB, nullable=True, comment="用于存储保证金转移等额外信息的JSON字段")
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    # --- 新增字段 ---
    is_settled = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default="false",
        index=True,
        comment="是否已结算 (收/付款完成)",
    )
    settlement_date = db.Column(db.Date, nullable=True, comment="结算日期 (收/付款日期)")
    settlement_details = db.Column(
        PG_JSONB,
        nullable=True,
        comment="结算详情 (e.g., {'method': '支付宝', 'notes': 'xxx', 'image_url': '...' })",
    )

    status = db.Column(
        db.String(50),
        nullable=False,
        default='PENDING',
        server_default='PENDING',
        index=True,
        comment="调整项生命周期状态 (PENDING, PAID, BILLED)"
    )
    paid_amount = db.Column(db.Numeric(10, 2), nullable=True, comment="账单前支付金额 (用于定金)")
    paid_at = db.Column(db.DateTime(timezone=True), nullable=True, comment="账单前支付时间(用于定金)")
    
    paid_by_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
        comment="记录该笔支付的操作员ID"
    )
    customer_bill = db.relationship('CustomerBill', backref=db.backref('financial_adjustments', lazy='dynamic'))
    employee_payroll = db.relationship('EmployeePayroll', backref=db.backref('financial_adjustments', lazy='dynamic'))
    def to_dict(self):
        try:
            # 这是你原来的字典定义，我保留了所有字段
            data = {
                "id": str(self.id),
                "adjustment_type": self.adjustment_type.value,
                "amount": str(self.amount),
                "description": self.description,
                "date": self.date.isoformat() if self.date else None,
                "contract_id": str(self.contract_id) if self.contract_id else None,
                "customer_bill_id": str(self.customer_bill_id) if self.customer_bill_id else None,
                "employee_payroll_id": str(self.employee_payroll_id) if self.employee_payroll_id else None,
                "details": self.details,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "is_settled": self.is_settled,
                "settlement_date": self.settlement_date.isoformat() if self.settlement_date else None,
                "settlement_details": self.settlement_details,
                "status": self.status,
                "paid_amount": str(self.paid_amount) if self.paid_amount is not None else None,
                "paid_at": self.paid_at.isoformat() if self.paid_at else None,
                "source_contract_id": None
            }

            # --- 【核心修改】优先从 details 字段获取来源ID ---
            if self.details and 'source_trial_contract_id' in self.details:
                data['source_contract_id'] = self.details['source_trial_contract_id']
            # --- 修改结束 ---

            # 保留旧的逻辑作为兼容性回退
            elif self.description and "试工合同" in self.description:
                contract = None
                if self.customer_bill:
                    contract = self.customer_bill.contract
                elif self.employee_payroll:
                    contract = self.employee_payroll.contract

                if contract and hasattr(contract, 'source_trial_contract_id')and contract.source_trial_contract_id:
                    data['source_contract_id'] = str(contract.source_trial_contract_id)

            return data

        except Exception as e:
            # 这是我们的调试“陷阱”
            print(f"--- FATAL SERIALIZATION ERROR ---")
            print(f"ERROR: Failed to serialize FinancialAdjustment with ID: {self.id}.")
            print(f"REASON: {e}")
            import traceback
            traceback.print_exc()
            print(f"--- END OF ERROR ---")
            return None

class InvoiceRecord(db.Model):
    __tablename__ = "invoice_records"
    __table_args__ = {"comment": "发票记录表"}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # --- 核心修改：关联到客户账单，而不是合同 ---
    customer_bill_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("customer_bills.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    # -----------------------------------------

    invoice_number = db.Column(db.String(255), nullable=True, comment="发票号码")
    amount = db.Column(db.Numeric(12, 2), nullable=False, comment="发票金额")
    issue_date = db.Column(db.Date, nullable=False, comment="开票日期")
    notes = db.Column(db.Text, nullable=True, comment="发票备注") # 允许备注为空
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    # 移除 status 字段，因为“已开具”状态由记录是否存在来体现

    def to_dict(self):
        return {
            "id": str(self.id),
            "customer_bill_id": str(self.customer_bill_id),
            "invoice_number": self.invoice_number,
            "amount": str(self.amount),
            "issue_date": self.issue_date.isoformat() if self.issue_date else None,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# --- 合同多态模型 ---
class BaseContract(db.Model):
    __tablename__ = "contracts"
    __table_args__ = {"comment": "合同基础信息表"}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = db.Column(db.String(50), nullable=False, default='jinshuju', server_default='jinshuju', comment="合同来源 (e.g., 'jinshuju', 'virtual')")
    type = db.Column(
        db.String(50),
        nullable=False,
        index=True,
        comment="合同类型鉴别器 (nanny, maternity_nurse, nanny_trial)",
    )

    jinshuju_entry_id = db.Column(
        db.String(255),
        nullable=True,
        index=True,
        comment="金数据中的原始数据Entry ID或serial_number",
    )

    customer_name = db.Column(db.String(255), nullable=False, index=True)
    customer_name_pinyin = db.Column(
        db.String(500), nullable=True, index=True, comment="客户姓名拼音"
    )
    contact_person = db.Column(db.String(255), comment="客户联系人")

    # employee_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('service_personnel.id'), nullable=False, index=True)
    # 我们不再使用一个通用的 employee_id，而是用两个可为空的外键
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="关联到系统用户 (如果是内部员工)",
    )
    service_personnel_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("service_personnel.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="关联到外部服务人员",
    )
    security_deposit_paid = db.Column(
        db.Numeric(10, 2), default=0, comment="客交保证金"
    )
    user = db.relationship("User", backref=db.backref("contracts", lazy="dynamic"))
    service_personnel = db.relationship(
        "ServicePersonnel", backref=db.backref("contracts", lazy="dynamic")
    )
    customer_bills = db.relationship(
        "CustomerBill",
        back_populates="contract",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    employee_payrolls = db.relationship(
        "EmployeePayroll",
        back_populates="contract",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    employee_level = db.Column(db.String(100), comment="级别，通常是月薪或服务价格")

    status = db.Column(
        db.String(50),
        default="active",
        nullable=False,
        index=True,
        comment="active, finished, terminated, trial_active, trial_succeeded",
    )
    termination_date = db.Column(db.DateTime(timezone=True), nullable=True, comment="合同终止日期") 
    notes = db.Column(db.Text, comment="通用备注")
    introduction_fee = db.Column(db.Numeric(10, 2), nullable=True, comment="介绍费")
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), onupdate=func.now())

    start_date = db.Column(db.DateTime(timezone=True), nullable=False, comment="合同开始日期与时间")
    end_date = db.Column(db.DateTime(timezone=True), nullable=False, comment="合同结束日期与时间")
    provisional_start_date = db.Column(db.Date, nullable=True, comment="预产期 (月嫂)")
    actual_onboarding_date = db.Column(
        db.DateTime(timezone=True), nullable=True, comment="实际上户日期 (月嫂)"
    )
    expected_offboarding_date = db.Column(
        db.DateTime(timezone=True), nullable=True, comment="预计下户日期 (可动态顺延)"
    )

    management_fee_amount = db.Column(
        db.Numeric(10, 2), nullable=True, comment="月管理费金额 (元/月)，从金数据同步的管理费金额"
    )

    management_fee_rate = db.Column(db.Numeric(4, 2), nullable=True, comment="管理费费率, e.g., 0.20 for 20%")

    invoice_needed = db.Column(db.Boolean, nullable=False, default=False, server_default='false', comment="本合同是否需要开票")

    __mapper_args__ = {"polymorphic_on": type, "polymorphic_identity": "base"}


class NannyContract(BaseContract):  # 育儿嫂合同
    __mapper_args__ = {"polymorphic_identity": "nanny"}

    is_monthly_auto_renew = db.Column(
        db.Boolean, default=False, comment="是否为自动续约的月签合同"
    )
    management_fee_paid_months = db.Column(
        ARRAY(db.String),
        default=[],
        comment='(月签)已缴管理费的月份列表 (e.g., ["2024-06"])'
    )
    is_first_month_fee_paid = db.Column(
        db.Boolean, default=False, comment="(年签)是否已缴首期全额管理费"
    )
    management_fee_status = db.Column(
        db.String(50),
        default="pending",
        comment="(年签)管理费支付状态 (pending, paid, partial)",
    )
    source_trial_contract_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True, index=True, comment="关联的源试工合同ID")

    source_trial_contract = db.relationship(
        'NannyTrialContract',
        foreign_keys=[source_trial_contract_id],
        backref=backref('converted_to_formal_contract', uselist=False),
        remote_side=[BaseContract.id],
        uselist=False
    )


class NannyTrialContract(BaseContract):  # 育儿嫂试工合同
    __mapper_args__ = {"polymorphic_identity": "nanny_trial"}
    trial_outcome = db.Column(SAEnum(TrialOutcome), nullable=False,default=TrialOutcome.PENDING, server_default=TrialOutcome.PENDING.value, index=True, comment="试工结果 (pending, success, failure)")
    
    

class ExternalSubstitutionContract(BaseContract):
    __tablename__ = 'external_substitution_contract'
    __table_args__ = {'comment': '外部替班合同'}

    id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('contracts.id', ondelete="CASCADE"), primary_key=True)
    

    __mapper_args__ = {
        'polymorphic_identity': 'external_substitution',
    }

class MaternityNurseContract(BaseContract):  # 月嫂合同
    __mapper_args__ = {"polymorphic_identity": "maternity_nurse"}
    # 月嫂定金统一为3000
    deposit_amount = db.Column(db.Numeric(10, 2), default=3000, comment="定金")
    # security_deposit_paid = db.Column(db.Numeric(10, 2), default=0, comment='客交保证金')
    discount_amount = db.Column(db.Numeric(10, 2), default=0, comment="优惠金额")


class FinancialActivityLog(db.Model):
    __tablename__ = "financial_activity_logs"

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # 关联到具体的账单或薪酬单
    customer_bill_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("customer_bills.id"),
        nullable=True,
        index=True,
    )
    employee_payroll_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("employee_payrolls.id"),
        nullable=True,
        index=True,
    )

    # 谁操作的
    user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey("user.id"), nullable=False)
    contract_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=True, # 允许为空，因为有些日志可能只与账单有关
        index=True,
        comment="关联的合同ID"
    )
    user = db.relationship("User")

    # 操作内容
    action = db.Column(
        db.String(255), nullable=False
    )  # 例如："修改加班", "添加优惠", "标记为已支付"
    details = db.Column(db.JSON, nullable=True)  # 记录变更详情，如 {"from": 1, "to": 2}

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    customer_bill = db.relationship("CustomerBill", back_populates="activity_logs")
    employee_payroll = db.relationship(
        "EmployeePayroll", back_populates="activity_logs"
    )

# --- V2.0 新增模型和枚举 ---

class PaymentStatus(enum.Enum):
    UNPAID = 'unpaid'
    PARTIALLY_PAID = 'partially_paid'
    PAID = 'paid'
    OVERPAID = 'overpaid'

class PaymentRecord(db.Model):
    __tablename__ = 'payment_records'
    __table_args__ = {'comment': '针对客户账单的支付记录表'}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bank_transaction_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('bank_transactions.id', ondelete='SET NULL'), nullable=True, index=True, comment='关联的银行交易流水ID')
    customer_bill_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('customer_bills.id', ondelete='CASCADE'), nullable=False,index=True)
    amount = db.Column(db.Numeric(12, 2), nullable=False, comment='本次支付金额')
    payment_date = db.Column(db.Date, nullable=False, comment='支付日期')
    method = db.Column(db.String(100), nullable=True, comment='支付方式')
    notes = db.Column(db.Text, nullable=True, comment='备注')
    image_url = db.Column(db.String(512), nullable=True, comment='支付凭证图片URL')
    created_by_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    customer_bill = db.relationship('CustomerBill', back_populates='payment_records')
    created_by_user = db.relationship('User')

    bank_transaction = db.relationship('BankTransaction', back_populates='payment_records')

    def to_dict(self):
        data = {
            "id": str(self.id),
            "customer_bill_id": str(self.customer_bill_id),
            "amount": str(self.amount),
            "payment_date": self.payment_date.isoformat() if self.payment_date else None,
            "method": self.method,
            "notes": self.notes,
            "image_url": self.image_url, # 先包含原始的相对路径
            # ... 其他字段
        }
        # 如果存在图片路径，则动态生成完整 URL 并覆盖
        if self.image_url:
            try:
                backend_host = current_app.config.get('BACKEND_BASE_URL', '')
                # 从相对路径中提取出真正的文件名
                filename = self.image_url.split('/')[-1]
                url_path = url_for('billing_api.serve_financial_record_upload',filename=filename)
                data['image_url'] = f"{backend_host}{url_path}"
            except RuntimeError:
                # 如果在应用上下文之外调用，则只返回相对路径
                pass
        return data

class PayoutStatus(enum.Enum):
    UNPAID = 'unpaid'
    PARTIALLY_PAID = 'partially_paid'
    PAID = 'paid'

class PayoutRecord(db.Model):
    __tablename__ = 'payout_records'
    __table_args__ = {'comment': '针对员工薪酬单的支付记录表'}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_payroll_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('employee_payrolls.id', ondelete='CASCADE'), nullable=False, index=True)
    amount = db.Column(db.Numeric(12, 2), nullable=False, comment='本次支付金额')
    payout_date = db.Column(db.Date, nullable=False, comment='支付日期')
    method = db.Column(db.String(100), nullable=True, comment='支付方式')
    notes = db.Column(db.Text, nullable=True, comment='备注')
    image_url = db.Column(db.String(512), nullable=True, comment='支付凭证图片URL')
    payer = db.Column(db.String(50), nullable=True, server_default='公司代付', comment='付款方 (客户支付/公司代付)')
    created_by_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    employee_payroll = db.relationship('EmployeePayroll', back_populates='payout_records')
    created_by_user = db.relationship('User')

    def to_dict(self):
        data = {
            "id": str(self.id),
            "employee_payroll_id": str(self.employee_payroll_id),
            "amount": str(self.amount),
            "payout_date": self.payout_date.isoformat() if self.payout_date else None,
            "method": self.method,
            "notes": self.notes,
            "payer": self.payer,
            "image_url": self.image_url, # 先包含原始的相对路径
            # ... 其他字段
        }
        # 如果存在图片路径，则动态生成完整 URL 并覆盖
        if self.image_url:
            try:
                backend_host = current_app.config.get('BACKEND_BASE_URL', '')
                filename = self.image_url.split('/')[-1]
                url_path = url_for('billing_api.serve_financial_record_upload',filename=filename)
                data['image_url'] = f"{backend_host}{url_path}"
            except RuntimeError:
                pass
        return data
# --- V2.0 重构 CustomerBill 模型 ---

class CustomerBill(db.Model):
    __tablename__ = "customer_bills"
    __table_args__ = (
        db.UniqueConstraint(
            "contract_id",
            "cycle_start_date",
            "is_substitute_bill",
            name="uq_bill_contract_cycle_is_sub",
        ),
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year = db.Column(db.Integer, nullable=False, index=True)
    month = db.Column(db.Integer, nullable=False, index=True)
    cycle_start_date = db.Column(db.DateTime(timezone=True), nullable=False)
    cycle_end_date = db.Column(db.DateTime(timezone=True), nullable=False)

    customer_name = db.Column(
        db.String(255), nullable=False
    )

    payment_details = db.Column(
        PG_JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
        comment="[V1遗留] 打款日期/渠道/总额/打款人等信息",
    )
    calculation_details = db.Column(
        PG_JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
        comment="计算过程快照，用于展示和审计",
    )
    invoice_needed = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="本账单是否需要开票",
    )
    invoices = db.relationship(
        "InvoiceRecord",
        backref="customer_bill",
        cascade="all, delete-orphan",
    )
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    contract = db.relationship("BaseContract", back_populates="customer_bills")
    activity_logs = db.relationship(
        "FinancialActivityLog",
        back_populates="customer_bill",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    actual_work_days = db.Column(db.Numeric(10, 3), nullable=True, comment="实际劳务天数")
    is_substitute_bill = db.Column(
        db.Boolean,
        default=False,
        nullable=False,
        server_default="false",
        index=True,
        comment="是否为替班账单",
    )
    source_substitute_record_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("substitute_records.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联的替班记录ID",
    )

    statement_id = db.Column(db.Integer, db.ForeignKey('monthly_statements.id', ondelete='SET NULL'), nullable=True, index=True)

    # --- V2.0 字段演进 ---
    payment_status = db.Column(
        SAEnum(PaymentStatus),
        nullable=False,
        default=PaymentStatus.UNPAID,
        server_default='unpaid',
        index=True
    )
    total_due = db.Column(db.Numeric(12, 2), nullable=False, server_default='0', comment='总应付金额 (由BillingEngine计算)')
    total_paid = db.Column(db.Numeric(12, 2), nullable=False, server_default='0', comment='已支付总额 (根据PaymentRecord实时更新)')

    # --- V2.0 关系建立 ---
    payment_records = db.relationship('PaymentRecord', back_populates='customer_bill', cascade='all, delete-orphan', lazy='dynamic')
    statement = db.relationship('MonthlyStatement', back_populates='bills')


# --- 【V2.0 重构 EmployeePayroll 模型】 ---
class EmployeePayroll(db.Model):
    __tablename__ = "employee_payrolls"
    __table_args__ = (
        db.UniqueConstraint(
            "contract_id",
            "cycle_start_date",
            "is_substitute_payroll",
            name="uq_payroll_contract_cycle_is_sub",
        ),
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year = db.Column(db.Integer, nullable=False, index=True)
    month = db.Column(db.Integer, nullable=False, index=True)
    cycle_start_date = db.Column(db.DateTime(timezone=True), nullable=False)
    cycle_end_date = db.Column(db.DateTime(timezone=True), nullable=False)
    employee_id = db.Column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="员工ID (可以是User或ServicePersonnel的ID)",
    )
    payout_details = db.Column(
        PG_JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
        comment="[V1遗留] 领款人/时间/途径等信息",
    )
    calculation_details = db.Column(
        PG_JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
        comment="计算过程快照",
    )
    contract = db.relationship("BaseContract", back_populates="employee_payrolls")
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    activity_logs = db.relationship(
        "FinancialActivityLog",
        back_populates="employee_payroll",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    actual_work_days = db.Column(db.Numeric(10, 2), nullable=True, comment="实际劳务天数")
    is_substitute_payroll = db.Column(
        db.Boolean,
        default=False,
        nullable=False,
        server_default="false",
        index=True,
        comment="是否为替班薪酬单",
    )
    source_substitute_record_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("substitute_records.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联的替班记录ID",
    )

    # --- V2.0 字段演进 ---
    total_due = db.Column(db.Numeric(10, 2), nullable=False, server_default="0", comment="员工总应发金额")
    payout_status = db.Column(
        SAEnum(PayoutStatus),
        nullable=False,
        default=PayoutStatus.UNPAID,
        server_default='unpaid',
        index=True
    )
    total_paid_out = db.Column(db.Numeric(12, 2), nullable=False, server_default='0', comment='已支付总额')

    # --- V2.0 关系建立 ---
    payout_records = db.relationship('PayoutRecord', back_populates='employee_payroll', cascade='all, delete-orphan', lazy='dynamic')


class AttendanceRecord(db.Model):
    __tablename__ = "attendance_records"
    __table_args__ = {"comment": "考勤记录表 (可跨月)"}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # 我们不再区分 user_id 和 service_personnel_id，而是用一个通用的 employee_id
    # 因为考勤总是针对一个具体的人，而这个人是谁已经在合同中定义了。
    # 我们可以通过合同反查到这个人是User还是ServicePersonnel。
    employee_id = db.Column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="员工ID (可以是User或ServicePersonnel的ID)",
    )
    contract_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # --- 核心修正：使用周期起止日期代替年月 ---
    cycle_start_date = db.Column(db.DateTime(timezone=True), nullable=False)
    cycle_end_date = db.Column(db.DateTime(timezone=True), nullable=False)
    # ----------------------------------------

    total_days_worked = db.Column(db.Numeric(10, 2), nullable=False, comment="总出勤天数")
    overtime_days = db.Column(db.Numeric(10, 2), default=0, comment="非节假日加班天数")
    statutory_holiday_days = db.Column(
        db.Numeric(10, 2), default=0, comment="法定节假日工作天数"
    )

    raw_data_entry_id = db.Column(
        db.String(255),
        nullable=True,
        comment="(如果考勤来自金数据)考勤表在金数据中的Entry ID",
    )

    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), onupdate=func.now())

    contract = db.relationship(
        "BaseContract", backref=db.backref("attendance_records", lazy="dynamic")
    )


class SubstituteRecord(db.Model):
    __tablename__ = "substitute_records"
    __table_args__ = {"comment": "替班记录表"}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # 关联到被替班的主合同
    main_contract_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 替班人员的ID (可以是内部User或外部ServicePersonnel)
    substitute_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    substitute_personnel_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("service_personnel.id", ondelete="SET NULL"),
        nullable=True,
    )
    substitute_type = db.Column(
        db.String(50), nullable=False, comment="替班人员类型 (maternity_nurse, nanny)"
    )

    # 替班期间的薪资标准和管理费
    substitute_salary = db.Column(
        db.Numeric(10, 2), nullable=False, comment="替班期间的月薪标准"
    )
    substitute_management_fee = db.Column(
        db.Numeric(10, 2), default=0, comment="替班产生的额外管理费"
    )

    # 替班的起止日期
    start_date = db.Column(db.DateTime(timezone=True), nullable=False, comment="替班开始日期时间")
    end_date = db.Column(db.DateTime(timezone=True), nullable=False, comment="替班结束日期时间")
    overtime_days = db.Column(
        db.Numeric(2, 1), nullable=False, server_default="0", comment="替班期间的加班天数"
    )

    notes = db.Column(db.Text, nullable=True, comment="替班备注")
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    main_contract = db.relationship(
        "BaseContract", backref=db.backref("substitute_records", lazy="dynamic")
    )
    substitute_user = db.relationship("User")
    substitute_personnel = db.relationship("ServicePersonnel")

    # --- 新增字段，用于回写生成的账单ID ---
    generated_bill_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("customer_bills.id", ondelete="SET NULL"),
        nullable=True,
        comment="生成的替班账单ID",
    )
    generated_payroll_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("employee_payrolls.id", ondelete="SET NULL"),
        nullable=True,
        comment="生成的替班薪酬单ID",
    )

    generated_bill = db.relationship(
        "CustomerBill",
        backref=backref("source_substitute_record", uselist=False),
        foreign_keys=[generated_bill_id],
    )
    generated_payroll = db.relationship(
        "EmployeePayroll",
        backref=backref("source_substitute_record", uselist=False),
        foreign_keys=[generated_payroll_id],
    )
    # ------------------------------------

    # --- 新增字段，用于关联被替班的原始账单 ---
    original_customer_bill_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("customer_bills.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="关联的被替班的原始账单ID",
    )
    original_customer_bill = db.relationship(
        "CustomerBill",
        foreign_keys=[original_customer_bill_id],
        backref="substitute_records_affecting_bill",
    )
    # ------------------------------------

    def __repr__(self):
        return f"<SubstituteRecord {self.id} for Contract {self.main_contract_id}>"

# --- TTS Provider State Model ---
class TtsProviderState(db.Model):
    __tablename__ = 'tts_provider_state'
    __table_args__ = (
        {'comment': '存储TTS提供商池的当前状态，以确保有状态的轮换。'}
    )

    # 使用一个字符串ID作为业务主键，方便查询特定池的状态。
    group_id = db.Column(db.String(100), primary_key=True, default='default_tts_pool')

    # 当前正在使用的提供商在 PROXY_POOL 列表中的索引。
    current_provider_index = db.Column(db.Integer, nullable=False, default=0)

    # 当前提供商已被使用的次数。
    usage_count = db.Column(db.Integer, nullable=False, default=0)

    # 状态最后更新的时间。
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f'<TtsProviderState {self.group_id}: Index {self.current_provider_index}, Count {self.usage_count}>'
