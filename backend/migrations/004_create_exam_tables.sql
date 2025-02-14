-- 创建考卷表
CREATE TABLE IF NOT EXISTS Exam (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 120,
    total_score INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 创建考卷题目关联表
CREATE TABLE IF NOT EXISTS ExamQuestion (
    exam_id UUID REFERENCES Exam(id) ON DELETE CASCADE,
    question_id UUID REFERENCES Question(id) ON DELETE CASCADE,
    question_order INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (exam_id, question_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_exam_created_at ON Exam(created_at);
CREATE INDEX IF NOT EXISTS idx_exam_question_exam_id ON ExamQuestion(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_question_question_id ON ExamQuestion(question_id);
