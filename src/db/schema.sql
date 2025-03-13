-- ExamDB Schema

-- 课程表
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 知识点表
CREATE TABLE knowledge_points (
    id SERIAL PRIMARY KEY,
    course_id INTEGER REFERENCES courses(id),
    content TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 题目表
CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    knowledge_point_id INTEGER REFERENCES knowledge_points(id),
    type VARCHAR(20) NOT NULL, -- 'single_choice' or 'multiple_choice'
    content TEXT NOT NULL,
    options JSONB NOT NULL, -- 存储选项数组
    correct_answers JSONB NOT NULL, -- 存储正确答案数组
    explanation TEXT,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 试卷表
CREATE TABLE exams (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    course_id INTEGER REFERENCES courses(id),
    duration INTEGER NOT NULL, -- 考试时长（分钟）
    total_score INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 试卷题目关联表
CREATE TABLE exam_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER REFERENCES exams(id),
    question_id INTEGER REFERENCES questions(id),
    score INTEGER NOT NULL, -- 该题分值
    question_order INTEGER NOT NULL, -- 题目顺序
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 学生表
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 验证码表
CREATE TABLE verification_codes (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 考试记录表
CREATE TABLE exam_records (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id),
    exam_id INTEGER REFERENCES exams(id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    score INTEGER,
    status VARCHAR(20) NOT NULL, -- 'in_progress', 'completed', 'timeout'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 答题记录表
CREATE TABLE answer_records (
    id SERIAL PRIMARY KEY,
    exam_record_id INTEGER REFERENCES exam_records(id),
    question_id INTEGER REFERENCES questions(id),
    student_answer JSONB NOT NULL,
    is_correct BOOLEAN NOT NULL,
    score INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX idx_knowledge_points_course_id ON knowledge_points(course_id);
CREATE INDEX idx_questions_knowledge_point_id ON questions(knowledge_point_id);
CREATE INDEX idx_exam_questions_exam_id ON exam_questions(exam_id);
CREATE INDEX idx_exam_questions_question_id ON exam_questions(question_id);
CREATE INDEX idx_exam_records_student_id ON exam_records(student_id);
CREATE INDEX idx_exam_records_exam_id ON exam_records(exam_id);
CREATE INDEX idx_answer_records_exam_record_id ON answer_records(exam_record_id);
CREATE INDEX idx_answer_records_question_id ON answer_records(question_id);
CREATE INDEX idx_verification_codes_phone ON verification_codes(phone);
