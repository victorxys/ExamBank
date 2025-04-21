# backend/models.py
import uuid
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB as PG_JSONB, ARRAY
from sqlalchemy import (
    Integer, String, Text, Boolean, DateTime, ForeignKey, func,
    UniqueConstraint, CheckConstraint, Index, Numeric, Enum as SAEnum, BigInteger, Table, # Use SAEnum to avoid conflict if needed
    ForeignKeyConstraint,PrimaryKeyConstraint # <--- 添加这个导入

)
from sqlalchemy.orm import relationship
from datetime import datetime # 仍然需要 datetime

# Import the 'db' instance from your extensions file
from .extensions import db

# --- Association Tables (Defined using db.Table) ---
exampapercourse_table = db.Table('exampapercourse', db.metadata,
    db.Column('exam_paper_id', PG_UUID(as_uuid=True), db.ForeignKey('exampaper.id', ondelete='CASCADE'), primary_key=True),
    db.Column('course_id', PG_UUID(as_uuid=True), db.ForeignKey('trainingcourse.id', ondelete='CASCADE'), primary_key=True),
    schema='public' # Optional: Add schema if not public
)

# exampaperquestion_table = db.Table('exampaperquestion', db.metadata,
#     # Original DDL had id, created_at, updated_at. Sticking to pure association table for now.
#     # If needed, convert this to a full model class.
#     db.Column('exam_paper_id', PG_UUID(as_uuid=True), db.ForeignKey('exampaper.id', ondelete='CASCADE'), primary_key=True),
#     db.Column('question_id', PG_UUID(as_uuid=True), db.ForeignKey('question.id', ondelete='CASCADE'), primary_key=True),
#     # UniqueConstraint('exam_paper_id', 'question_id', name='exampaperquestion_exam_paper_id_question_id_key'), # Re-add if needed
#     schema='public' # Optional: Add schema if not public
# )

# --- Model Classes (Inheriting from db.Model) ---

# backend/models.py
# ... 其他导入 ...

class ExamPaperQuestion(db.Model):
    __tablename__ = 'exampaperquestion'
    __table_args__ = (
        # 如果需要，重新定义唯一约束
        UniqueConstraint('exam_paper_id', 'question_id', name='exampaperquestion_exam_paper_id_question_id_key'),
        {'comment': '试卷题目关联表，存储试卷和题目的多对多关系及元数据'}
    )

    # 定义列，与您数据库中的一致
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    exam_paper_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('exampaper.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到 ExamPaper 表')
    question_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('question.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到 Question 表')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    # 定义与 ExamPaper 和 Question 的关系 (Many-to-One)
    # back_populates 用于双向关系
    exam_paper = db.relationship('ExamPaper', back_populates='question_associations')
    question = db.relationship('Question', back_populates='exam_paper_associations')

    def __repr__(self):
        return f'<ExamPaperQuestion Link {self.exam_paper_id} <-> {self.question_id}>'

class AlembicVersion(db.Model):
    __tablename__ = 'alembic_version'
    version_num = db.Column(db.String(32), primary_key=True, nullable=False)

class Answer(db.Model):
    __tablename__ = 'answer'
    # Define constraints within the model if preferred over __table_args__
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    question_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('question.id', ondelete='CASCADE'), unique=True, nullable=False, comment='外键，关联到 Question 表，一对一关系')
    answer_text = db.Column(db.Text, nullable=True, comment='参考答案文本 (对于问答题)')
    explanation = db.Column(db.Text, nullable=True, comment='答案解析')
    source = db.Column(db.Text, nullable=True, comment='答案出处')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    # question relationship defined in Question model via backref

    def __repr__(self):
        return f'<Answer for Q {self.question_id}>'

class AnswerRecord(db.Model):
    __tablename__ = 'answerrecord'
    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    exam_paper_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('exampaper.id'), nullable=False, comment='外键，关联到 ExamPaper 表')
    question_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('question.id'), nullable=False, comment='外键，关联到 Question 表')
    selected_option_ids = db.Column(ARRAY(PG_UUID(as_uuid=True)), nullable=True, comment='用户选择的选项 ID 列表 (用于单选和多选)')
    answer_text = db.Column(db.Text, nullable=True, comment='用户填写的答案 (用于问答)')
    score = db.Column(db.Integer, nullable=True, comment='该题得分')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='答题时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id'), nullable=False, comment='答题者 ID, 外键, 关联到user表')
    exam_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('exam.id', ondelete='CASCADE'), nullable=True, comment='考试ID，外键关联到 exam 表')

    # Relationships defined elsewhere (User, ExamPaper, Question, Exam) via backref

    def __repr__(self):
        return f'<AnswerRecord {self.id}>'

class Customer(db.Model):
    __tablename__ = 'customer'
    __table_args__ = (UniqueConstraint('phone_number', name='customer_phone_number_key'), {'comment': '客户信息表'}) # Keep table args for constraints/comments

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='客户ID (主键)')
    first_name = db.Column(db.String(255), nullable=False, comment='客户的姓')
    last_name = db.Column(db.String(255), nullable=True, comment='客户的名')
    title = db.Column(db.String(50), nullable=True, comment='称谓 (先生/女士/小姐等)')
    phone_number = db.Column(db.String(20), nullable=True, comment='联系电话') # Unique constraint in table_args
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    evaluations_given = db.relationship('Evaluation', backref='evaluator_customer', lazy='dynamic', foreign_keys='Evaluation.evaluator_customer_id')

    def __repr__(self):
        return f'<Customer {self.first_name} {self.last_name or ""}>'

class EmployeeSelfEvaluation(db.Model):
    __tablename__ = 'employee_self_evaluation'
    __table_args__ = ({'comment': '员工自评表'})

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    name = db.Column(db.String(255), nullable=False, comment='评价者姓名')
    phone_number = db.Column(db.String(20), nullable=False, comment='评价者手机号')
    additional_comments = db.Column(db.Text, nullable=True, comment='评价补充说明')
    evaluation_time = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='评价时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    details = db.relationship('EmployeeSelfEvaluationDetail', backref='evaluation', lazy=True, cascade="all, delete-orphan")

    def __repr__(self):
        return f'<EmployeeSelfEvaluation {self.id} by {self.name}>'

class EmployeeSelfEvaluationDetail(db.Model):
    __tablename__ = 'employee_self_evaluation_detail'
    __table_args__ = (
        CheckConstraint('score >= 0 AND score <= 100', name='employee_self_evaluation_detail_score_check'),
        {'comment': '员工自评详情表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    evaluation_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('employee_self_evaluation.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到员工自评表')
    item_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation_item.id'), nullable=False, comment='外键，关联到评价项表')
    score = db.Column(db.Integer, nullable=False, comment='评价分数 (0-100)')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')

    item = db.relationship('EvaluationItem', backref='self_evaluation_details')
    # evaluation defined by backref

    def __repr__(self):
        return f'<EmployeeSelfEvaluationDetail {self.id}>'

class Evaluation(db.Model):
    __tablename__ = 'evaluation'
    __table_args__ = (
        CheckConstraint('(evaluator_user_id IS NOT NULL AND evaluator_customer_id IS NULL) OR (evaluator_user_id IS NULL AND evaluator_customer_id IS NOT NULL)', name='chk_evaluation_evaluator'),
        ForeignKeyConstraint(['evaluator_customer_id'], ['customer.id'], name='fk_evaluation_evaluator_customer_id', ondelete='SET NULL'),
        ForeignKeyConstraint(['evaluator_user_id'], ['user.id'], name='fk_evaluation_evaluator_user_id', ondelete='SET NULL'),
        ForeignKeyConstraint(['evaluated_user_id'], ['user.id'], name='evaluation_evaluated_user_id_fkey'), # Assuming FK exists
        {'comment': '评价表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    evaluated_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id'), nullable=False, comment='被评价人ID，外键，关联到user表')
    evaluator_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete='SET NULL'), nullable=True, comment='评价人ID，外键，关联到user表')
    evaluator_customer_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('customer.id', ondelete='SET NULL'), nullable=True, comment='评价人ID (客户)，外键，关联到 customer 表')
    evaluation_time = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='评价时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    additional_comments = db.Column(db.Text, nullable=True, comment='评价补充说明 (人工填写)')

    details = db.relationship('EvaluationDetail', backref='evaluation', lazy=True, cascade="all, delete-orphan")
    # evaluated_user and evaluator_user/customer relationships defined in User/Customer models

    def __repr__(self):
        evaluator = f"User {self.evaluator_user_id}" if self.evaluator_user_id else f"Customer {self.evaluator_customer_id}"
        return f'<Evaluation {self.id} by {evaluator} for User {self.evaluated_user_id}>'

class EvaluationAspect(db.Model):
    __tablename__ = 'evaluation_aspect'
    __table_args__ = (Index('idx_evaluation_aspect_sort_order', 'sort_order'), {'comment': '评价方面表'})

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    aspect_name = db.Column(db.String(255), nullable=False, comment='方面名称')
    description = db.Column(db.Text, nullable=True, comment='方面描述')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    sort_order = db.Column(db.Integer, default=0, nullable=True, server_default='0') # Added

    categories = db.relationship('EvaluationCategory', backref='aspect', lazy=True, cascade="all, delete-orphan", order_by='EvaluationCategory.sort_order')

    def __repr__(self):
        return f'<EvaluationAspect {self.id} {self.aspect_name}>'

# Note: evaluation_backup is not defined as a model, Alembic will try to drop it.

class EvaluationCategory(db.Model):
    __tablename__ = 'evaluation_category'
    __table_args__ = (
        Index('idx_evaluation_category_aspect_id_sort_order', 'aspect_id', 'sort_order'),
        ForeignKeyConstraint(['aspect_id'], ['evaluation_aspect.id'], ondelete='CASCADE', name='evaluation_category_aspect_id_fkey'), # Add FK name if needed
        {'comment': '评价类别表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    aspect_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation_aspect.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到评价方面表')
    category_name = db.Column(db.String(255), nullable=False, comment='类别名称')
    description = db.Column(db.Text, nullable=True, comment='类别描述')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    sort_order = db.Column(db.Integer, default=0, nullable=True, server_default='0') # Added
    allow_manual_input = db.Column(db.Boolean, nullable=False, default=False, server_default='false', comment='是否允许对该类别进行手动文字输入 (TRUE: 允许, FALSE: 不允许)')
    items = db.relationship('EvaluationItem', backref='category', lazy=True, cascade="all, delete-orphan", order_by='EvaluationItem.sort_order')
    # aspect relationship defined by backref

    def __repr__(self):
        return f'<EvaluationCategory {self.id} {self.category_name}>'

class EvaluationDetail(db.Model): # Renamed from t_evaluation_detail
    __tablename__ = 'evaluation_detail'
    __table_args__ = (
         ForeignKeyConstraint(['evaluation_id'], ['evaluation.id'], ondelete='CASCADE', name='evaluation_detail_evaluation_id_fkey'), # Add FK name if needed
         ForeignKeyConstraint(['item_id'], ['evaluation_item.id'], name='evaluation_detail_item_id_fkey'), # Add FK name if needed
        {'comment': '评价详情表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    evaluation_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到评价表')
    item_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation_item.id'), nullable=False, comment='外键，关联到评价项表')
    score = db.Column(db.Integer, nullable=True, comment='评价分数 (30, 20, 或 10)') # Nullable based on DDL
    comment = db.Column(db.Text, nullable=True, comment='评价备注')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')

    item = db.relationship('EvaluationItem', backref='evaluation_details')
    # evaluation relationship defined by backref

    def __repr__(self):
        return f'<EvaluationDetail {self.id} for Eval {self.evaluation_id}>'

class EvaluationItem(db.Model):
    __tablename__ = 'evaluation_item'
    __table_args__ = (
        Index('idx_evaluation_item_category_id_sort_order', 'category_id', 'sort_order'),
        ForeignKeyConstraint(['category_id'], ['evaluation_category.id'], ondelete='CASCADE', name='evaluation_item_category_id_fkey'), # Add FK name if needed
        PrimaryKeyConstraint('id', name='evaluation_item_pkey'), # Explicit PK
        {'comment': '评价项表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    category_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation_category.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到评价类别表')
    item_name = db.Column(db.String(255), nullable=False, comment='评价项名称')
    description = db.Column(db.Text, nullable=True, comment='评价项描述')
    is_visible_to_client = db.Column(db.Boolean, nullable=False, default=False, server_default='false', comment='是否展示给客户 (TRUE: 展示, FALSE: 不展示)')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    sort_order = db.Column(db.Integer, default=0, nullable=True, server_default='0') # Added

    # evaluation_details relationship defined by backref
    # self_evaluation_details relationship defined by backref
    # category relationship defined by backref

    def __repr__(self):
        return f'<EvaluationItem {self.id} {self.item_name}>'


class Exam(db.Model):
    __tablename__ = 'exam'
    __table_args__ = (
        ForeignKeyConstraint(['exam_paper_id'], ['exampaper.id'], name='exam_exam_paper_id_fkey', ondelete='RESTRICT'),
        ForeignKeyConstraint(['user_id'], ['user.id'], name='exam_user_id_fkey', ondelete='RESTRICT'),
        PrimaryKeyConstraint('id', name='exam_pkey'),
        {'comment': '考试表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='考试ID (主键)')
    exam_paper_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('exampaper.id', ondelete='RESTRICT'), nullable=False, comment='试卷ID，外键关联到 exampaper 表')
    user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, comment='用户ID，外键关联到 user 表')
    single_choice_count = db.Column(db.Integer, nullable=False, comment='单选题数量')
    multiple_choice_count = db.Column(db.Integer, nullable=False, comment='多选题数量')
    total_score = db.Column(db.Integer, nullable=False, comment='试卷总分')
    correct_rate = db.Column(db.Numeric(5, 2), nullable=True, comment='正确率')
    knowledge_point_summary = db.Column(PG_JSONB, nullable=True, comment='知识点掌握情况 (JSON 数组)')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    finished = db.Column(db.Boolean, default=False, comment='是否完成考试')

    answer_records = db.relationship('AnswerRecord', backref='exam', lazy=True, foreign_keys='AnswerRecord.exam_id', cascade="all, delete-orphan")
    # exam_paper and user relationships defined by backref

    def __repr__(self):
      return f'<Exam {self.id} for User {self.user_id}>'


class ExamPaper(db.Model):
    __tablename__ = 'exampaper'
    __table_args__ = ({'comment': '试卷表，存储试卷的基本信息'})

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    title = db.Column(db.String(255), nullable=False, comment='试卷标题')
    description = db.Column(db.Text, nullable=True, comment='试卷描述')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    courses = db.relationship('TrainingCourse', secondary=exampapercourse_table, back_populates='exam_papers', lazy='dynamic')
    # questions = db.relationship('Question', secondary=exampaperquestion_table, back_populates='exam_papers', lazy='dynamic')
    question_associations = db.relationship('ExamPaperQuestion', back_populates='exam_paper', lazy='dynamic', cascade="all, delete-orphan")

    exams = db.relationship('Exam', backref='exam_paper', lazy=True) # One ExamPaper to Many Exams
    answer_records = db.relationship('AnswerRecord', backref='exam_paper', lazy=True, foreign_keys='AnswerRecord.exam_paper_id')
    temp_answers = db.relationship('TempAnswerRecord', backref='exam_paper', lazy=True)

    def __repr__(self):
        return f'<ExamPaper {self.title}>'


class KnowledgePoint(db.Model):
    __tablename__ = 'knowledgepoint'
    __table_args__ = (
        ForeignKeyConstraint(['course_id'], ['trainingcourse.id'], ondelete='CASCADE', name='knowledgepoint_course_id_fkey'),
        {'comment': '知识点表, 存储各个课程下的知识点'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    course_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('trainingcourse.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到 TrainingCourse 表')
    point_name = db.Column(db.String(255), nullable=False, comment='知识点名称')
    description = db.Column(db.Text, nullable=True, comment='知识点描述')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    questions = db.relationship('Question', backref='knowledge_point', lazy=True, cascade="all, delete-orphan")
    # course defined by backref

    def __repr__(self):
        return f'<KnowledgePoint {self.point_name}>'


class Option(db.Model):
    __tablename__ = 'option'
    __table_args__ = (
         ForeignKeyConstraint(['question_id'], ['question.id'], ondelete='CASCADE', name='option_question_id_fkey'),
        {'comment': '选项表，存储题目的选项'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    question_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('question.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到 Question 表')
    option_text = db.Column(db.Text, nullable=False, comment='选项文本')
    is_correct = db.Column(db.Boolean, default=False, nullable=True, server_default='false', comment='是否为正确答案')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    # question defined by backref

    def __repr__(self):
        return f'<Option {self.id} for Q {self.question_id}>'


class Question(db.Model):
    __tablename__ = 'question'
    __table_args__ = (
         ForeignKeyConstraint(['knowledge_point_id'], ['knowledgepoint.id'], ondelete='CASCADE', name='question_knowledge_point_id_fkey'),
        {'comment': '题目表，存储题库中的题目'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    knowledge_point_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('knowledgepoint.id', ondelete='CASCADE'), nullable=False, comment='外键，关联到 KnowledgePoint 表')
    question_type = db.Column(db.String(50), nullable=False, comment='题目类型 (例如："单选", "多选", "问答")')
    question_text = db.Column(db.Text, nullable=False, comment='题干')
    difficulty = db.Column(db.Integer, nullable=True, comment='题目难度 1-5')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    options = db.relationship('Option', backref='question', lazy=True, cascade="all, delete-orphan", order_by='Option.id')
    answer = db.relationship('Answer', backref='question', uselist=False, cascade="all, delete-orphan")
    # exam_papers = db.relationship('ExamPaper', secondary=exampaperquestion_table, back_populates='questions', lazy='dynamic')
    exam_paper_associations = db.relationship('ExamPaperQuestion', back_populates='question', lazy='dynamic', cascade="all, delete-orphan")

    answer_records = db.relationship('AnswerRecord', backref='question', lazy=True)
    temp_answers = db.relationship('TempAnswerRecord', backref='question', lazy=True)
    # knowledge_point defined by backref

    def __repr__(self):
        return f'<Question {self.id} ({self.question_type})>'


class TempAnswerRecord(db.Model):
    __tablename__ = 'temp_answer_record'
    __table_args__ = (
        Index('idx_temp_answer_record_exam_user', 'exam_paper_id', 'user_id'),
        Index('idx_temp_answer_record_is_submitted', 'is_submitted'),
        ForeignKeyConstraint(['exam_paper_id'], ['exampaper.id'], name='temp_answer_record_exam_paper_id_fkey'), # Assuming FK exists
        ForeignKeyConstraint(['question_id'], ['question.id'], name='temp_answer_record_question_id_fkey'), # Assuming FK exists
        ForeignKeyConstraint(['user_id'], ['user.id'], name='temp_answer_record_user_id_fkey'), # Assuming FK exists
        {'comment': '临时答题记录表，存储用户的答题进度'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键')
    exam_paper_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('exampaper.id'), nullable=False, comment='外键，关联到 ExamPaper 表')
    question_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('question.id'), nullable=False, comment='外键，关联到 Question 表')
    selected_option_ids = db.Column(ARRAY(PG_UUID(as_uuid=True)), nullable=True, comment='用户选择的选项 ID 列表 (用于单选和多选)')
    answer_text = db.Column(db.Text, nullable=True, comment='用户填写的答案 (用于问答)')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='答题时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id'), nullable=False, comment='答题者 ID, 外键, 关联到user表')
    is_submitted = db.Column(db.Boolean, default=False, comment='是否已提交')

    # Relationships defined elsewhere via backref

    def __repr__(self):
        return f'<TempAnswerRecord {self.id}>'


class TrainingCourse(db.Model):
    __tablename__ = 'trainingcourse'
    __table_args__ = ({'comment': '培训课程表，存储课程的基本信息'})

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='主键，使用 UUID，自动生成')
    course_name = db.Column(db.String(255), nullable=False, comment='课程名称，不允许为空')
    age_group = db.Column(db.String(50), nullable=True, comment='适用月龄 (例如："2-3个月", "3-4个月")')
    description = db.Column(db.Text, nullable=True, comment='课程描述，可为空')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间，带时区的时间戳，默认值为当前时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间，带时区的时间戳，默认值为当前时间')

    knowledge_points = db.relationship('KnowledgePoint', backref='course', lazy=True, cascade="all, delete-orphan")
    exam_papers = db.relationship('ExamPaper', secondary=exampapercourse_table, back_populates='courses', lazy='dynamic')

    def __repr__(self):
        return f'<TrainingCourse {self.course_name}>'


class User(db.Model):
    __tablename__ = 'user'
    __table_args__ = (
        UniqueConstraint('phone_number', name='user_phone_number_key'),
        # UniqueConstraint('email', name='user_email_key'), # Assuming email should be unique
        {'comment': '用户表'}
    )

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, comment='用户ID')
    username = db.Column(db.String(255), nullable=False, comment='用户名')
    phone_number = db.Column(db.String(20), nullable=False, comment='手机号') # Unique constraint in table_args
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    password = db.Column(db.Text, nullable=False, comment='密码（加密存储）')
    role = db.Column(db.String(50), nullable=False, default='student', server_default='student', comment='用户角色（admin/teacher/student）')
    email = db.Column(db.String(255), nullable=True, comment='邮箱') # Unique constraint in table_args
    status = db.Column(db.String(50), nullable=False, default='active', server_default='active', comment='用户状态（active/inactive）')
    avatar = db.Column(db.String(255), nullable=True, comment='用户头像 URL')
    myms_user_id = db.Column(db.BigInteger, nullable=True, comment='关联到另一个数据库中用户的 ID')

    # Relationships
    profile = db.relationship('UserProfile', backref='user', uselist=False, cascade="all, delete-orphan")
    exams_taken = db.relationship('Exam', backref='user', lazy='dynamic', foreign_keys='Exam.user_id')
    answer_records = db.relationship('AnswerRecord', backref='user', lazy='dynamic', foreign_keys='AnswerRecord.user_id')
    temp_answers = db.relationship('TempAnswerRecord', backref='user', lazy='dynamic', foreign_keys='TempAnswerRecord.user_id')
    evaluations_received = db.relationship('Evaluation', backref='evaluated_user', lazy='dynamic', foreign_keys='Evaluation.evaluated_user_id')
    evaluations_given = db.relationship('Evaluation', backref='evaluator_user', lazy='dynamic', foreign_keys='Evaluation.evaluator_user_id')

    def __repr__(self):
        return f'<User {self.username}>'

class UserProfile(db.Model):
    __tablename__ = 'user_profile'
    __table_args__ = (
        ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE', name='user_profile_user_id_fkey'),
        Index('idx_user_profile_data', 'profile_data', postgresql_using='gin'), # Specify index type for JSONB
        PrimaryKeyConstraint('user_id', name='user_profile_pkey'),
        {'comment': '用户详细信息表'}
    )

    user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True, comment='用户ID，主键，外键关联到 user 表')
    profile_data = db.Column(PG_JSONB, nullable=False, comment='用户详细信息 (JSON 格式)')
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')

    # user relationship defined by backref

    def __repr__(self):
        return f'<UserProfile for User {self.user_id}>'

class EvaluationManualInput(db.Model):
    __tablename__ = 'evaluation_manual_input'
    # 如果表已存在且有自己的主键，可以不定义 id
    # id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    evaluation_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation.id', ondelete='CASCADE'), primary_key=True, nullable=False) # 与 evaluation_id, category_id 组成联合主键更常见
    category_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('evaluation_category.id', ondelete='CASCADE'), primary_key=True, nullable=False)
    manual_input = db.Column(db.Text, nullable=True) # 允许为空，因为不是所有类别都有手动输入
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    # 定义关系 (可选，但推荐)
    evaluation = db.relationship('Evaluation', backref=db.backref('manual_inputs', lazy=True, cascade='all, delete-orphan'))
    category = db.relationship('EvaluationCategory')

    # 如果使用联合主键，则不需要单独的 id 列
    # 如果 evaluation_id 和 category_id 不是主键，确保有 UNIQUE 约束
    # __table_args__ = (db.UniqueConstraint('evaluation_id', 'category_id', name='uq_evaluation_manual_input_eval_cat'),)

    def __repr__(self):
        return f'<EvaluationManualInput Eval:{self.evaluation_id} Cat:{self.category_id}>'