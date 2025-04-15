from typing import List, Optional

from sqlalchemy import ARRAY, BigInteger, Boolean, CheckConstraint, Column, Enum, ForeignKeyConstraint, Index, Integer, Numeric, PrimaryKeyConstraint, String, Table, Text, UniqueConstraint, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
import datetime
import decimal
import uuid

class Base(DeclarativeBase):
    pass


t_answer = Table(
    'answer', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('question_id', Uuid, nullable=False, comment='外键，关联到 Question 表，一对一关系'),
    Column('answer_text', Text, comment='参考答案文本 (对于问答题)'),
    Column('explanation', Text, comment='答案解析'),
    Column('source', Text, comment='答案出处'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    comment='参考答案表，存储题目的参考答案和解析'
)


class Customer(Base):
    __tablename__ = 'customer'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='customer_pkey'),
        UniqueConstraint('phone_number', name='customer_phone_number_key'),
        {'comment': '客户信息表'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='客户ID (主键)')
    first_name: Mapped[str] = mapped_column(String(255), comment='客户的姓')
    last_name: Mapped[Optional[str]] = mapped_column(String(255), comment='客户的名')
    title: Mapped[Optional[str]] = mapped_column(String(50), comment='称谓 (先生/女士/小姐等)')
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), comment='联系电话')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')


class EmployeeSelfEvaluation(Base):
    __tablename__ = 'employee_self_evaluation'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='employee_self_evaluation_pkey'),
        {'comment': '员工自评表'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键')
    name: Mapped[str] = mapped_column(String(255), comment='评价者姓名')
    phone_number: Mapped[str] = mapped_column(String(20), comment='评价者手机号')
    additional_comments: Mapped[Optional[str]] = mapped_column(Text, comment='评价补充说明')
    evaluation_time: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='评价时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')


t_employee_self_evaluation_detail = Table(
    'employee_self_evaluation_detail', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('evaluation_id', Uuid, nullable=False, comment='外键，关联到员工自评表'),
    Column('item_id', Uuid, nullable=False, comment='外键，关联到评价项表'),
    Column('score', Integer, nullable=False, comment='评价分数 (0-100)'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间'),
    CheckConstraint('score >= 0 AND score <= 100', name='employee_self_evaluation_detail_score_check'),
    comment='员工自评详情表'
)


t_evaluation_aspect = Table(
    'evaluation_aspect', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('aspect_name', String(255), nullable=False, comment='方面名称'),
    Column('description', Text, comment='方面描述'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    Column('sort_order', Integer, server_default=text('0')),
    Index('idx_evaluation_aspect_sort_order', 'sort_order'),
    comment='评价方面表'
)


t_evaluation_backup = Table(
    'evaluation_backup', Base.metadata,
    Column('id', Uuid),
    Column('evaluated_user_id', Uuid),
    Column('evaluator_user_id', Uuid),
    Column('evaluation_time', TIMESTAMP(True, 6)),
    Column('updated_at', TIMESTAMP(True, 6)),
    Column('additional_comments', Text),
    Column('evaluation_type', Enum('internal', 'client', name='evaluation_type'))
)


t_evaluation_category = Table(
    'evaluation_category', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('aspect_id', Uuid, nullable=False, comment='外键，关联到评价方面表'),
    Column('category_name', String(255), nullable=False, comment='类别名称'),
    Column('description', Text, comment='类别描述'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    Column('sort_order', Integer, server_default=text('0')),
    Index('idx_evaluation_category_aspect_id_sort_order', 'aspect_id', 'sort_order'),
    comment='评价类别表'
)


t_evaluation_detail = Table(
    'evaluation_detail', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('evaluation_id', Uuid, nullable=False, comment='外键，关联到评价表'),
    Column('item_id', Uuid, nullable=False, comment='外键，关联到评价项表'),
    Column('score', Integer, comment='评价分数 (30, 20, 或 10)'),
    Column('comment', Text, comment='评价备注'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间'),
    comment='评价详情表'
)


t_evaluation_item = Table(
    'evaluation_item', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('category_id', Uuid, nullable=False, comment='外键，关联到评价类别表'),
    Column('item_name', String(255), nullable=False, comment='评价项名称'),
    Column('description', Text, comment='评价项描述'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    Column('is_visible_to_client', Boolean, nullable=False, server_default=text('false'), comment='是否展示给客户 (TRUE: 展示, FALSE: 不展示)'),
    Column('sort_order', Integer, server_default=text('0')),
    Index('idx_evaluation_item_category_id_sort_order', 'category_id', 'sort_order'),
    comment='评价项表'
)


class Exam(Base):
    __tablename__ = 'exam'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='exam_pkey'),
        {'comment': '考试表'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='考试ID (主键)')
    exam_paper_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='试卷ID，外键关联到 exampaper 表')
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='用户ID，外键关联到 user 表')
    single_choice_count: Mapped[int] = mapped_column(Integer, comment='单选题数量')
    multiple_choice_count: Mapped[int] = mapped_column(Integer, comment='多选题数量')
    total_score: Mapped[int] = mapped_column(Integer, comment='试卷总分')
    correct_rate: Mapped[Optional[decimal.Decimal]] = mapped_column(Numeric(5, 2), comment='正确率')
    knowledge_point_summary: Mapped[Optional[dict]] = mapped_column(JSONB, comment='知识点掌握情况 (JSON 数组)')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')
    finished: Mapped[Optional[bool]] = mapped_column(Boolean, server_default=text('false'), comment='是否完成考试')


class Exampaper(Base):
    __tablename__ = 'exampaper'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='exampaper_pkey'),
        {'comment': '试卷表，存储试卷的基本信息'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键')
    title: Mapped[str] = mapped_column(String(255), comment='试卷标题')
    description: Mapped[Optional[str]] = mapped_column(Text, comment='试卷描述')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')

    course: Mapped[List['Trainingcourse']] = relationship('Trainingcourse', secondary='exampapercourse', back_populates='exam_paper')
    exampaperquestion: Mapped[List['Exampaperquestion']] = relationship('Exampaperquestion', back_populates='exam_paper')


t_temp_answer_record = Table(
    'temp_answer_record', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('exam_paper_id', Uuid, nullable=False, comment='外键，关联到 ExamPaper 表'),
    Column('question_id', Uuid, nullable=False, comment='外键，关联到 Question 表'),
    Column('selected_option_ids', ARRAY(Uuid()), comment='用户选择的选项 ID 列表 (用于单选和多选)'),
    Column('answer_text', Text, comment='用户填写的答案 (用于问答)'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='答题时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    Column('user_id', Uuid, nullable=False, comment='答题者 ID, 外键, 关联到user表'),
    Column('is_submitted', Boolean, server_default=text('false'), comment='是否已提交'),
    Index('idx_temp_answer_record_exam_user', 'exam_paper_id', 'user_id'),
    Index('idx_temp_answer_record_is_submitted', 'is_submitted'),
    comment='临时答题记录表，存储用户的答题进度'
)


class Trainingcourse(Base):
    __tablename__ = 'trainingcourse'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='trainingcourse_pkey'),
        {'comment': '培训课程表，存储课程的基本信息'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键，使用 UUID，自动生成')
    course_name: Mapped[str] = mapped_column(String(255), comment='课程名称，不允许为空')
    age_group: Mapped[Optional[str]] = mapped_column(String(50), comment='适用月龄 (例如："2-3个月", "3-4个月")')
    description: Mapped[Optional[str]] = mapped_column(Text, comment='课程描述，可为空')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间，带时区的时间戳，默认值为当前时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间，带时区的时间戳，默认值为当前时间')

    exam_paper: Mapped[List['Exampaper']] = relationship('Exampaper', secondary='exampapercourse', back_populates='course')
    knowledgepoint: Mapped[List['Knowledgepoint']] = relationship('Knowledgepoint', back_populates='course')


class User(Base):
    __tablename__ = 'user'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='user_pkey'),
        UniqueConstraint('phone_number', name='user_phone_number_key'),
        {'comment': '用户表'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='用户ID')
    username: Mapped[str] = mapped_column(String(255), comment='用户名')
    phone_number: Mapped[str] = mapped_column(String(20), comment='手机号')
    password: Mapped[str] = mapped_column(Text, comment='密码（加密存储）')
    role: Mapped[str] = mapped_column(String(50), server_default=text("'student'::character varying"), comment='用户角色（admin/teacher/student）')
    status: Mapped[str] = mapped_column(String(50), server_default=text("'active'::character varying"), comment='用户状态（active/inactive）')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')
    email: Mapped[Optional[str]] = mapped_column(String(255), comment='邮箱')
    avatar: Mapped[Optional[str]] = mapped_column(String(255), comment='用户头像 URL')
    myms_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment='关联到另一个数据库中用户的 ID')


t_answerrecord = Table(
    'answerrecord', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('exam_paper_id', Uuid, nullable=False, comment='外键，关联到 ExamPaper 表'),
    Column('question_id', Uuid, nullable=False, comment='外键，关联到 Question 表'),
    Column('selected_option_ids', ARRAY(Uuid()), comment='用户选择的选项 ID 列表 (用于单选和多选)'),
    Column('answer_text', Text, comment='用户填写的答案 (用于问答)'),
    Column('score', Integer, comment='该题得分'),
    Column('created_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='答题时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    Column('user_id', Uuid, nullable=False, comment='答题者 ID, 外键, 关联到user表'),
    Column('exam_id', Uuid, comment='考试ID，外键关联到 exam 表'),
    ForeignKeyConstraint(['exam_id'], ['exam.id'], ondelete='CASCADE', name='answerrecord_exam_id_fkey'),
    comment='答题记录表，存储用户的答题信息'
)


t_evaluation = Table(
    'evaluation', Base.metadata,
    Column('id', Uuid, nullable=False, server_default=text('gen_random_uuid()'), comment='主键'),
    Column('evaluated_user_id', Uuid, nullable=False, comment='被评价人ID，外键，关联到user表'),
    Column('evaluator_user_id', Uuid, comment='评价人ID，外键，关联到user表'),
    Column('evaluation_time', TIMESTAMP(True, 6), server_default=text('now()'), comment='评价时间'),
    Column('updated_at', TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间'),
    Column('additional_comments', Text, comment='评价补充说明 (人工填写)'),
    Column('evaluator_customer_id', Uuid, comment='评价人ID (客户)，外键，关联到 customer 表'),
    CheckConstraint('evaluator_user_id IS NOT NULL AND evaluator_customer_id IS NULL OR evaluator_user_id IS NULL AND evaluator_customer_id IS NOT NULL', name='chk_evaluation_evaluator'),
    ForeignKeyConstraint(['evaluator_customer_id'], ['customer.id'], ondelete='SET NULL', name='fk_evaluation_evaluator_customer_id'),
    ForeignKeyConstraint(['evaluator_user_id'], ['user.id'], ondelete='SET NULL', name='fk_evaluation_evaluator_user_id'),
    comment='评价表'
)


t_exampapercourse = Table(
    'exampapercourse', Base.metadata,
    Column('exam_paper_id', Uuid, primary_key=True, nullable=False),
    Column('course_id', Uuid, primary_key=True, nullable=False),
    ForeignKeyConstraint(['course_id'], ['trainingcourse.id'], ondelete='CASCADE', name='exampapercourse_course_id_fkey'),
    ForeignKeyConstraint(['exam_paper_id'], ['exampaper.id'], ondelete='CASCADE', name='exampapercourse_exam_paper_id_fkey'),
    PrimaryKeyConstraint('exam_paper_id', 'course_id', name='exampapercourse_pkey')
)


class Knowledgepoint(Base):
    __tablename__ = 'knowledgepoint'
    __table_args__ = (
        ForeignKeyConstraint(['course_id'], ['trainingcourse.id'], ondelete='CASCADE', name='knowledgepoint_course_id_fkey'),
        PrimaryKeyConstraint('id', name='knowledgepoint_pkey'),
        {'comment': '知识点表, 存储各个课程下的知识点'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键')
    course_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='外键，关联到 TrainingCourse 表')
    point_name: Mapped[str] = mapped_column(String(255), comment='知识点名称')
    description: Mapped[Optional[str]] = mapped_column(Text, comment='知识点描述')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')

    course: Mapped['Trainingcourse'] = relationship('Trainingcourse', back_populates='knowledgepoint')
    question: Mapped[List['Question']] = relationship('Question', back_populates='knowledge_point')


class UserProfile(User):
    __tablename__ = 'user_profile'
    __table_args__ = (
        ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE', name='user_profile_user_id_fkey'),
        PrimaryKeyConstraint('user_id', name='user_profile_pkey'),
        Index('idx_user_profile_data', 'profile_data'),
        {'comment': '用户详细信息表'}
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, comment='用户ID，主键，外键关联到 user 表')
    profile_data: Mapped[dict] = mapped_column(JSONB, comment='用户详细信息 (JSON 格式)')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')


class Question(Base):
    __tablename__ = 'question'
    __table_args__ = (
        ForeignKeyConstraint(['knowledge_point_id'], ['knowledgepoint.id'], ondelete='CASCADE', name='question_knowledge_point_id_fkey'),
        PrimaryKeyConstraint('id', name='question_pkey'),
        {'comment': '题目表，存储题库中的题目'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键')
    knowledge_point_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='外键，关联到 KnowledgePoint 表')
    question_type: Mapped[str] = mapped_column(String(50), comment='题目类型 (例如："单选", "多选", "问答")')
    question_text: Mapped[str] = mapped_column(Text, comment='题干')
    difficulty: Mapped[Optional[int]] = mapped_column(Integer, comment='题目难度 1-5')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')

    knowledge_point: Mapped['Knowledgepoint'] = relationship('Knowledgepoint', back_populates='question')
    exampaperquestion: Mapped[List['Exampaperquestion']] = relationship('Exampaperquestion', back_populates='question')
    option: Mapped[List['Option']] = relationship('Option', back_populates='question')


class Exampaperquestion(Base):
    __tablename__ = 'exampaperquestion'
    __table_args__ = (
        ForeignKeyConstraint(['exam_paper_id'], ['exampaper.id'], ondelete='CASCADE', name='exampaperquestion_exam_paper_id_fkey'),
        ForeignKeyConstraint(['question_id'], ['question.id'], ondelete='CASCADE', name='exampaperquestion_question_id_fkey'),
        PrimaryKeyConstraint('id', name='exampaperquestion_pkey'),
        UniqueConstraint('exam_paper_id', 'question_id', name='exampaperquestion_exam_paper_id_question_id_key'),
        {'comment': '试卷题目关联表，存储试卷和题目的多对多关系'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键')
    exam_paper_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='外键，关联到 ExamPaper 表')
    question_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='外键，关联到 Question 表')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')

    exam_paper: Mapped['Exampaper'] = relationship('Exampaper', back_populates='exampaperquestion')
    question: Mapped['Question'] = relationship('Question', back_populates='exampaperquestion')


class Option(Base):
    __tablename__ = 'option'
    __table_args__ = (
        ForeignKeyConstraint(['question_id'], ['question.id'], ondelete='CASCADE', name='option_question_id_fkey'),
        PrimaryKeyConstraint('id', name='option_pkey'),
        {'comment': '选项表，存储题目的选项'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'), comment='主键')
    question_id: Mapped[uuid.UUID] = mapped_column(Uuid, comment='外键，关联到 Question 表')
    option_text: Mapped[str] = mapped_column(Text, comment='选项文本')
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean, server_default=text('false'), comment='是否为正确答案')
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='创建时间')
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(TIMESTAMP(True, 6), server_default=text('now()'), comment='更新时间')

    question: Mapped['Question'] = relationship('Question', back_populates='option')
