/*
 Navicat Premium Data Transfer

 Source Server         : local_chatai
 Source Server Type    : PostgreSQL
 Source Server Version : 130018 (130018)
 Source Host           : localhost:5432
 Source Catalog        : ExamDB
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 130018 (130018)
 File Encoding         : 65001

 Date: 02/03/2025 23:57:28
*/


-- ----------------------------
-- Table structure for answer
-- ----------------------------
DROP TABLE IF EXISTS "public"."answer";
CREATE TABLE "public"."answer" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "question_id" uuid NOT NULL,
  "answer_text" text COLLATE "pg_catalog"."default",
  "explanation" text COLLATE "pg_catalog"."default",
  "source" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."answer" OWNER TO "postgres";
COMMENT ON COLUMN "public"."answer"."id" IS '主键';
COMMENT ON COLUMN "public"."answer"."question_id" IS '外键，关联到 Question 表，一对一关系';
COMMENT ON COLUMN "public"."answer"."answer_text" IS '参考答案文本 (对于问答题)';
COMMENT ON COLUMN "public"."answer"."explanation" IS '答案解析';
COMMENT ON COLUMN "public"."answer"."source" IS '答案出处';
COMMENT ON COLUMN "public"."answer"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."answer"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."answer" IS '参考答案表，存储题目的参考答案和解析';

-- ----------------------------
-- Table structure for answerrecord
-- ----------------------------
DROP TABLE IF EXISTS "public"."answerrecord";
CREATE TABLE "public"."answerrecord" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "exam_paper_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "selected_option_ids" uuid[],
  "answer_text" text COLLATE "pg_catalog"."default",
  "score" int4,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "user_id" uuid NOT NULL
)
;
ALTER TABLE "public"."answerrecord" OWNER TO "postgres";
COMMENT ON COLUMN "public"."answerrecord"."id" IS '主键';
COMMENT ON COLUMN "public"."answerrecord"."exam_paper_id" IS '外键，关联到 ExamPaper 表';
COMMENT ON COLUMN "public"."answerrecord"."question_id" IS '外键，关联到 Question 表';
COMMENT ON COLUMN "public"."answerrecord"."selected_option_ids" IS '用户选择的选项 ID 列表 (用于单选和多选)';
COMMENT ON COLUMN "public"."answerrecord"."answer_text" IS '用户填写的答案 (用于问答)';
COMMENT ON COLUMN "public"."answerrecord"."score" IS '该题得分';
COMMENT ON COLUMN "public"."answerrecord"."created_at" IS '答题时间';
COMMENT ON COLUMN "public"."answerrecord"."updated_at" IS '更新时间';
COMMENT ON COLUMN "public"."answerrecord"."user_id" IS '答题者 ID, 外键, 关联到user表';
COMMENT ON TABLE "public"."answerrecord" IS '答题记录表，存储用户的答题信息';

-- ----------------------------
-- Table structure for evaluation
-- ----------------------------
DROP TABLE IF EXISTS "public"."evaluation";
CREATE TABLE "public"."evaluation" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "evaluated_user_id" uuid NOT NULL,
  "evaluator_user_id" uuid NOT NULL,
  "evaluation_time" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."evaluation" OWNER TO "postgres";
COMMENT ON COLUMN "public"."evaluation"."id" IS '主键';
COMMENT ON COLUMN "public"."evaluation"."evaluated_user_id" IS '被评价人ID，外键，关联到user表';
COMMENT ON COLUMN "public"."evaluation"."evaluator_user_id" IS '评价人ID，外键，关联到user表';
COMMENT ON COLUMN "public"."evaluation"."evaluation_time" IS '评价时间';
COMMENT ON COLUMN "public"."evaluation"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."evaluation" IS '评价表';

-- ----------------------------
-- Table structure for evaluation_aspect
-- ----------------------------
DROP TABLE IF EXISTS "public"."evaluation_aspect";
CREATE TABLE "public"."evaluation_aspect" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "aspect_name" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."evaluation_aspect" OWNER TO "postgres";
COMMENT ON COLUMN "public"."evaluation_aspect"."id" IS '主键';
COMMENT ON COLUMN "public"."evaluation_aspect"."aspect_name" IS '方面名称';
COMMENT ON COLUMN "public"."evaluation_aspect"."description" IS '方面描述';
COMMENT ON COLUMN "public"."evaluation_aspect"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."evaluation_aspect"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."evaluation_aspect" IS '评价方面表';

-- ----------------------------
-- Table structure for evaluation_category
-- ----------------------------
DROP TABLE IF EXISTS "public"."evaluation_category";
CREATE TABLE "public"."evaluation_category" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "aspect_id" uuid NOT NULL,
  "category_name" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."evaluation_category" OWNER TO "postgres";
COMMENT ON COLUMN "public"."evaluation_category"."id" IS '主键';
COMMENT ON COLUMN "public"."evaluation_category"."aspect_id" IS '外键，关联到评价方面表';
COMMENT ON COLUMN "public"."evaluation_category"."category_name" IS '类别名称';
COMMENT ON COLUMN "public"."evaluation_category"."description" IS '类别描述';
COMMENT ON COLUMN "public"."evaluation_category"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."evaluation_category"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."evaluation_category" IS '评价类别表';

-- ----------------------------
-- Table structure for evaluation_detail
-- ----------------------------
DROP TABLE IF EXISTS "public"."evaluation_detail";
CREATE TABLE "public"."evaluation_detail" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "evaluation_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "score" int4 NOT NULL,
  "comment" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."evaluation_detail" OWNER TO "postgres";
COMMENT ON COLUMN "public"."evaluation_detail"."id" IS '主键';
COMMENT ON COLUMN "public"."evaluation_detail"."evaluation_id" IS '外键，关联到评价表';
COMMENT ON COLUMN "public"."evaluation_detail"."item_id" IS '外键，关联到评价项表';
COMMENT ON COLUMN "public"."evaluation_detail"."score" IS '评价分数 (30, 20, 或 10)';
COMMENT ON COLUMN "public"."evaluation_detail"."comment" IS '评价备注';
COMMENT ON COLUMN "public"."evaluation_detail"."created_at" IS '创建时间';
COMMENT ON TABLE "public"."evaluation_detail" IS '评价详情表';

-- ----------------------------
-- Table structure for evaluation_item
-- ----------------------------
DROP TABLE IF EXISTS "public"."evaluation_item";
CREATE TABLE "public"."evaluation_item" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "category_id" uuid NOT NULL,
  "item_name" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."evaluation_item" OWNER TO "postgres";
COMMENT ON COLUMN "public"."evaluation_item"."id" IS '主键';
COMMENT ON COLUMN "public"."evaluation_item"."category_id" IS '外键，关联到评价类别表';
COMMENT ON COLUMN "public"."evaluation_item"."item_name" IS '评价项名称';
COMMENT ON COLUMN "public"."evaluation_item"."description" IS '评价项描述';
COMMENT ON COLUMN "public"."evaluation_item"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."evaluation_item"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."evaluation_item" IS '评价项表';

-- ----------------------------
-- Table structure for exampaper
-- ----------------------------
DROP TABLE IF EXISTS "public"."exampaper";
CREATE TABLE "public"."exampaper" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "title" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."exampaper" OWNER TO "postgres";
COMMENT ON COLUMN "public"."exampaper"."id" IS '主键';
COMMENT ON COLUMN "public"."exampaper"."title" IS '试卷标题';
COMMENT ON COLUMN "public"."exampaper"."description" IS '试卷描述';
COMMENT ON COLUMN "public"."exampaper"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."exampaper"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."exampaper" IS '试卷表，存储试卷的基本信息';

-- ----------------------------
-- Table structure for exampapercourse
-- ----------------------------
DROP TABLE IF EXISTS "public"."exampapercourse";
CREATE TABLE "public"."exampapercourse" (
  "exam_paper_id" uuid NOT NULL,
  "course_id" uuid NOT NULL
)
;
ALTER TABLE "public"."exampapercourse" OWNER TO "victor";

-- ----------------------------
-- Table structure for exampaperquestion
-- ----------------------------
DROP TABLE IF EXISTS "public"."exampaperquestion";
CREATE TABLE "public"."exampaperquestion" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "exam_paper_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."exampaperquestion" OWNER TO "postgres";
COMMENT ON COLUMN "public"."exampaperquestion"."id" IS '主键';
COMMENT ON COLUMN "public"."exampaperquestion"."exam_paper_id" IS '外键，关联到 ExamPaper 表';
COMMENT ON COLUMN "public"."exampaperquestion"."question_id" IS '外键，关联到 Question 表';
COMMENT ON COLUMN "public"."exampaperquestion"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."exampaperquestion"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."exampaperquestion" IS '试卷题目关联表，存储试卷和题目的多对多关系';

-- ----------------------------
-- Table structure for knowledgepoint
-- ----------------------------
DROP TABLE IF EXISTS "public"."knowledgepoint";
CREATE TABLE "public"."knowledgepoint" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "course_id" uuid NOT NULL,
  "point_name" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."knowledgepoint" OWNER TO "postgres";
COMMENT ON COLUMN "public"."knowledgepoint"."id" IS '主键';
COMMENT ON COLUMN "public"."knowledgepoint"."course_id" IS '外键，关联到 TrainingCourse 表';
COMMENT ON COLUMN "public"."knowledgepoint"."point_name" IS '知识点名称';
COMMENT ON COLUMN "public"."knowledgepoint"."description" IS '知识点描述';
COMMENT ON COLUMN "public"."knowledgepoint"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."knowledgepoint"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."knowledgepoint" IS '知识点表, 存储各个课程下的知识点';

-- ----------------------------
-- Table structure for option
-- ----------------------------
DROP TABLE IF EXISTS "public"."option";
CREATE TABLE "public"."option" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "question_id" uuid NOT NULL,
  "option_text" text COLLATE "pg_catalog"."default" NOT NULL,
  "is_correct" bool DEFAULT false,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."option" OWNER TO "postgres";
COMMENT ON COLUMN "public"."option"."id" IS '主键';
COMMENT ON COLUMN "public"."option"."question_id" IS '外键，关联到 Question 表';
COMMENT ON COLUMN "public"."option"."option_text" IS '选项文本';
COMMENT ON COLUMN "public"."option"."is_correct" IS '是否为正确答案';
COMMENT ON COLUMN "public"."option"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."option"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."option" IS '选项表，存储题目的选项';

-- ----------------------------
-- Table structure for question
-- ----------------------------
DROP TABLE IF EXISTS "public"."question";
CREATE TABLE "public"."question" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_point_id" uuid NOT NULL,
  "question_type" varchar(50) COLLATE "pg_catalog"."default" NOT NULL,
  "question_text" text COLLATE "pg_catalog"."default" NOT NULL,
  "difficulty" int4,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."question" OWNER TO "postgres";
COMMENT ON COLUMN "public"."question"."id" IS '主键';
COMMENT ON COLUMN "public"."question"."knowledge_point_id" IS '外键，关联到 KnowledgePoint 表';
COMMENT ON COLUMN "public"."question"."question_type" IS '题目类型 (例如："单选", "多选", "问答")';
COMMENT ON COLUMN "public"."question"."question_text" IS '题干';
COMMENT ON COLUMN "public"."question"."difficulty" IS '题目难度 1-5';
COMMENT ON COLUMN "public"."question"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."question"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."question" IS '题目表，存储题库中的题目';

-- ----------------------------
-- Table structure for temp_answer_record
-- ----------------------------
DROP TABLE IF EXISTS "public"."temp_answer_record";
CREATE TABLE "public"."temp_answer_record" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "exam_paper_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "selected_option_ids" uuid[],
  "answer_text" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "user_id" uuid NOT NULL,
  "is_submitted" bool DEFAULT false
)
;
ALTER TABLE "public"."temp_answer_record" OWNER TO "postgres";
COMMENT ON COLUMN "public"."temp_answer_record"."id" IS '主键';
COMMENT ON COLUMN "public"."temp_answer_record"."exam_paper_id" IS '外键，关联到 ExamPaper 表';
COMMENT ON COLUMN "public"."temp_answer_record"."question_id" IS '外键，关联到 Question 表';
COMMENT ON COLUMN "public"."temp_answer_record"."selected_option_ids" IS '用户选择的选项 ID 列表 (用于单选和多选)';
COMMENT ON COLUMN "public"."temp_answer_record"."answer_text" IS '用户填写的答案 (用于问答)';
COMMENT ON COLUMN "public"."temp_answer_record"."created_at" IS '答题时间';
COMMENT ON COLUMN "public"."temp_answer_record"."updated_at" IS '更新时间';
COMMENT ON COLUMN "public"."temp_answer_record"."user_id" IS '答题者 ID, 外键, 关联到user表';
COMMENT ON COLUMN "public"."temp_answer_record"."is_submitted" IS '是否已提交';
COMMENT ON TABLE "public"."temp_answer_record" IS '临时答题记录表，存储用户的答题进度';

-- ----------------------------
-- Table structure for trainingcourse
-- ----------------------------
DROP TABLE IF EXISTS "public"."trainingcourse";
CREATE TABLE "public"."trainingcourse" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "course_name" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "age_group" varchar(50) COLLATE "pg_catalog"."default",
  "description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."trainingcourse" OWNER TO "postgres";
COMMENT ON COLUMN "public"."trainingcourse"."id" IS '主键，使用 UUID，自动生成';
COMMENT ON COLUMN "public"."trainingcourse"."course_name" IS '课程名称，不允许为空';
COMMENT ON COLUMN "public"."trainingcourse"."age_group" IS '适用月龄 (例如："2-3个月", "3-4个月")';
COMMENT ON COLUMN "public"."trainingcourse"."description" IS '课程描述，可为空';
COMMENT ON COLUMN "public"."trainingcourse"."created_at" IS '创建时间，带时区的时间戳，默认值为当前时间';
COMMENT ON COLUMN "public"."trainingcourse"."updated_at" IS '更新时间，带时区的时间戳，默认值为当前时间';
COMMENT ON TABLE "public"."trainingcourse" IS '培训课程表，存储课程的基本信息';

-- ----------------------------
-- Table structure for user
-- ----------------------------
DROP TABLE IF EXISTS "public"."user";
CREATE TABLE "public"."user" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "username" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "phone_number" varchar(20) COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "password" varchar(255) COLLATE "pg_catalog"."default" NOT NULL DEFAULT NULL::character varying,
  "role" varchar(50) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'student'::character varying,
  "email" varchar(255) COLLATE "pg_catalog"."default",
  "status" varchar(50) COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'active'::character varying
)
;
ALTER TABLE "public"."user" OWNER TO "postgres";
COMMENT ON COLUMN "public"."user"."id" IS '用户ID';
COMMENT ON COLUMN "public"."user"."username" IS '用户名';
COMMENT ON COLUMN "public"."user"."phone_number" IS '手机号';
COMMENT ON COLUMN "public"."user"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."user"."updated_at" IS '更新时间';
COMMENT ON COLUMN "public"."user"."password" IS '密码（加密存储）';
COMMENT ON COLUMN "public"."user"."role" IS '用户角色（admin/teacher/student）';
COMMENT ON COLUMN "public"."user"."email" IS '邮箱';
COMMENT ON COLUMN "public"."user"."status" IS '用户状态（active/inactive）';
COMMENT ON TABLE "public"."user" IS '用户表';

-- ----------------------------
-- Table structure for user_profile
-- ----------------------------
DROP TABLE IF EXISTS "public"."user_profile";
CREATE TABLE "public"."user_profile" (
  "user_id" uuid NOT NULL,
  "profile_data" jsonb NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
ALTER TABLE "public"."user_profile" OWNER TO "postgres";
COMMENT ON COLUMN "public"."user_profile"."user_id" IS '用户ID，主键，外键关联到 user 表';
COMMENT ON COLUMN "public"."user_profile"."profile_data" IS '用户详细信息 (JSON 格式)';
COMMENT ON COLUMN "public"."user_profile"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."user_profile"."updated_at" IS '更新时间';
COMMENT ON TABLE "public"."user_profile" IS '用户详细信息表';

-- ----------------------------
-- Function structure for calculate_score
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."calculate_score"("p_exam_paper_id" uuid, "p_user_id" varchar);
CREATE OR REPLACE FUNCTION "public"."calculate_score"("p_exam_paper_id" uuid, "p_user_id" varchar)
  RETURNS "pg_catalog"."int4" AS $BODY$
DECLARE
    total_score INTEGER := 0;
    question_record RECORD;
    correct_option_ids UUID[];
    user_option_ids UUID[];
BEGIN
    -- 遍历用户在该试卷上的所有答题记录
    FOR question_record IN
        SELECT question_id, selected_option_ids
        FROM AnswerRecord
        WHERE exam_paper_id = p_exam_paper_id AND user_id = p_user_id
    LOOP
        -- 获取该题目的标准答案 (正确选项的 ID 列表)
        SELECT ARRAY_AGG(id) INTO correct_option_ids
        FROM Option
        WHERE question_id = question_record.question_id AND is_correct = TRUE;

        -- 获取用户选择的选项 ID 列表
        user_option_ids := question_record.selected_option_ids;

        -- 判断答案是否正确 (完全匹配)
        IF user_option_ids = correct_option_ids THEN
            -- 获取该题目的分值, 可以在Question表中增加一个score字段表示分值.
            -- 这里假定每题1分。
            total_score := total_score + 1; 
        END IF;
    END LOOP;

    RETURN total_score;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;
ALTER FUNCTION "public"."calculate_score"("p_exam_paper_id" uuid, "p_user_id" varchar) OWNER TO "postgres";

-- ----------------------------
-- Function structure for update_modified_column
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_modified_column"();
CREATE OR REPLACE FUNCTION "public"."update_modified_column"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;
ALTER FUNCTION "public"."update_modified_column"() OWNER TO "postgres";

-- ----------------------------
-- Function structure for uuid_generate_v1
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_generate_v1"();
CREATE OR REPLACE FUNCTION "public"."uuid_generate_v1"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_generate_v1'
  LANGUAGE c VOLATILE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_generate_v1"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_generate_v1mc
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_generate_v1mc"();
CREATE OR REPLACE FUNCTION "public"."uuid_generate_v1mc"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_generate_v1mc'
  LANGUAGE c VOLATILE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_generate_v1mc"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_generate_v3
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_generate_v3"("namespace" uuid, "name" text);
CREATE OR REPLACE FUNCTION "public"."uuid_generate_v3"("namespace" uuid, "name" text)
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_generate_v3'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_generate_v3"("namespace" uuid, "name" text) OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_generate_v4
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_generate_v4"();
CREATE OR REPLACE FUNCTION "public"."uuid_generate_v4"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_generate_v4'
  LANGUAGE c VOLATILE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_generate_v4"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_generate_v5
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_generate_v5"("namespace" uuid, "name" text);
CREATE OR REPLACE FUNCTION "public"."uuid_generate_v5"("namespace" uuid, "name" text)
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_generate_v5'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_generate_v5"("namespace" uuid, "name" text) OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_nil
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_nil"();
CREATE OR REPLACE FUNCTION "public"."uuid_nil"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_nil'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_nil"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_ns_dns
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_ns_dns"();
CREATE OR REPLACE FUNCTION "public"."uuid_ns_dns"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_ns_dns'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_ns_dns"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_ns_oid
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_ns_oid"();
CREATE OR REPLACE FUNCTION "public"."uuid_ns_oid"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_ns_oid'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_ns_oid"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_ns_url
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_ns_url"();
CREATE OR REPLACE FUNCTION "public"."uuid_ns_url"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_ns_url'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_ns_url"() OWNER TO "victor";

-- ----------------------------
-- Function structure for uuid_ns_x500
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."uuid_ns_x500"();
CREATE OR REPLACE FUNCTION "public"."uuid_ns_x500"()
  RETURNS "pg_catalog"."uuid" AS '$libdir/uuid-ossp', 'uuid_ns_x500'
  LANGUAGE c IMMUTABLE STRICT
  COST 1;
ALTER FUNCTION "public"."uuid_ns_x500"() OWNER TO "victor";

-- ----------------------------
-- Triggers structure for table answer
-- ----------------------------
CREATE TRIGGER "update_answer_modtime" BEFORE UPDATE ON "public"."answer"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Uniques structure for table answer
-- ----------------------------
ALTER TABLE "public"."answer" ADD CONSTRAINT "answer_question_id_key" UNIQUE ("question_id");

-- ----------------------------
-- Primary Key structure for table answer
-- ----------------------------
ALTER TABLE "public"."answer" ADD CONSTRAINT "answer_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table answerrecord
-- ----------------------------
CREATE TRIGGER "update_answerrecord_modtime" BEFORE UPDATE ON "public"."answerrecord"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table answerrecord
-- ----------------------------
ALTER TABLE "public"."answerrecord" ADD CONSTRAINT "answerrecord_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table evaluation
-- ----------------------------
CREATE TRIGGER "update_evaluation_modtime" BEFORE UPDATE ON "public"."evaluation"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table evaluation
-- ----------------------------
ALTER TABLE "public"."evaluation" ADD CONSTRAINT "evaluation_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table evaluation_aspect
-- ----------------------------
CREATE TRIGGER "update_evaluation_aspect_modtime" BEFORE UPDATE ON "public"."evaluation_aspect"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table evaluation_aspect
-- ----------------------------
ALTER TABLE "public"."evaluation_aspect" ADD CONSTRAINT "evaluation_aspect_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table evaluation_category
-- ----------------------------
CREATE TRIGGER "update_evaluation_category_modtime" BEFORE UPDATE ON "public"."evaluation_category"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table evaluation_category
-- ----------------------------
ALTER TABLE "public"."evaluation_category" ADD CONSTRAINT "evaluation_category_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Primary Key structure for table evaluation_detail
-- ----------------------------
ALTER TABLE "public"."evaluation_detail" ADD CONSTRAINT "evaluation_detail_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table evaluation_item
-- ----------------------------
CREATE TRIGGER "update_evaluation_item_modtime" BEFORE UPDATE ON "public"."evaluation_item"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table evaluation_item
-- ----------------------------
ALTER TABLE "public"."evaluation_item" ADD CONSTRAINT "evaluation_item_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table exampaper
-- ----------------------------
CREATE TRIGGER "update_exampaper_modtime" BEFORE UPDATE ON "public"."exampaper"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table exampaper
-- ----------------------------
ALTER TABLE "public"."exampaper" ADD CONSTRAINT "exampaper_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Primary Key structure for table exampapercourse
-- ----------------------------
ALTER TABLE "public"."exampapercourse" ADD CONSTRAINT "exampapercourse_pkey" PRIMARY KEY ("exam_paper_id", "course_id");

-- ----------------------------
-- Triggers structure for table exampaperquestion
-- ----------------------------
CREATE TRIGGER "update_exampaperquestion_modtime" BEFORE UPDATE ON "public"."exampaperquestion"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Uniques structure for table exampaperquestion
-- ----------------------------
ALTER TABLE "public"."exampaperquestion" ADD CONSTRAINT "exampaperquestion_exam_paper_id_question_id_key" UNIQUE ("exam_paper_id", "question_id");

-- ----------------------------
-- Primary Key structure for table exampaperquestion
-- ----------------------------
ALTER TABLE "public"."exampaperquestion" ADD CONSTRAINT "exampaperquestion_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table knowledgepoint
-- ----------------------------
CREATE TRIGGER "update_knowledgepoint_modtime" BEFORE UPDATE ON "public"."knowledgepoint"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table knowledgepoint
-- ----------------------------
ALTER TABLE "public"."knowledgepoint" ADD CONSTRAINT "knowledgepoint_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table option
-- ----------------------------
CREATE TRIGGER "update_option_modtime" BEFORE UPDATE ON "public"."option"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table option
-- ----------------------------
ALTER TABLE "public"."option" ADD CONSTRAINT "option_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table question
-- ----------------------------
CREATE TRIGGER "update_question_modtime" BEFORE UPDATE ON "public"."question"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table question
-- ----------------------------
ALTER TABLE "public"."question" ADD CONSTRAINT "question_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table temp_answer_record
-- ----------------------------
CREATE INDEX "idx_temp_answer_record_exam_user" ON "public"."temp_answer_record" USING btree (
  "exam_paper_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_temp_answer_record_is_submitted" ON "public"."temp_answer_record" USING btree (
  "is_submitted" "pg_catalog"."bool_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table trainingcourse
-- ----------------------------
CREATE TRIGGER "update_trainingcourse_modtime" BEFORE UPDATE ON "public"."trainingcourse"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table trainingcourse
-- ----------------------------
ALTER TABLE "public"."trainingcourse" ADD CONSTRAINT "trainingcourse_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table user
-- ----------------------------
CREATE TRIGGER "update_user_modtime" BEFORE UPDATE ON "public"."user"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Uniques structure for table user
-- ----------------------------
ALTER TABLE "public"."user" ADD CONSTRAINT "user_phone_number_key" UNIQUE ("phone_number");

-- ----------------------------
-- Primary Key structure for table user
-- ----------------------------
ALTER TABLE "public"."user" ADD CONSTRAINT "user_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table user_profile
-- ----------------------------
CREATE INDEX "idx_user_profile_data" ON "public"."user_profile" USING gin (
  "profile_data" "pg_catalog"."jsonb_ops"
);

-- ----------------------------
-- Triggers structure for table user_profile
-- ----------------------------
CREATE TRIGGER "update_user_profile_modtime" BEFORE UPDATE ON "public"."user_profile"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_modified_column"();

-- ----------------------------
-- Primary Key structure for table user_profile
-- ----------------------------
ALTER TABLE "public"."user_profile" ADD CONSTRAINT "user_profile_pkey" PRIMARY KEY ("user_id");

-- ----------------------------
-- Foreign Keys structure for table answer
-- ----------------------------
ALTER TABLE "public"."answer" ADD CONSTRAINT "answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."question" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table answerrecord
-- ----------------------------
ALTER TABLE "public"."answerrecord" ADD CONSTRAINT "answerrecord_exam_paper_id_fkey" FOREIGN KEY ("exam_paper_id") REFERENCES "public"."exampaper" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."answerrecord" ADD CONSTRAINT "answerrecord_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."question" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."answerrecord" ADD CONSTRAINT "answerrecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table evaluation
-- ----------------------------
ALTER TABLE "public"."evaluation" ADD CONSTRAINT "evaluation_evaluated_user_id_fkey" FOREIGN KEY ("evaluated_user_id") REFERENCES "public"."user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."evaluation" ADD CONSTRAINT "evaluation_evaluator_user_id_fkey" FOREIGN KEY ("evaluator_user_id") REFERENCES "public"."user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table evaluation_category
-- ----------------------------
ALTER TABLE "public"."evaluation_category" ADD CONSTRAINT "evaluation_category_aspect_id_fkey" FOREIGN KEY ("aspect_id") REFERENCES "public"."evaluation_aspect" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table evaluation_detail
-- ----------------------------
ALTER TABLE "public"."evaluation_detail" ADD CONSTRAINT "evaluation_detail_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."evaluation_detail" ADD CONSTRAINT "evaluation_detail_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."evaluation_item" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table evaluation_item
-- ----------------------------
ALTER TABLE "public"."evaluation_item" ADD CONSTRAINT "evaluation_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."evaluation_category" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table exampapercourse
-- ----------------------------
ALTER TABLE "public"."exampapercourse" ADD CONSTRAINT "exampapercourse_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."trainingcourse" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."exampapercourse" ADD CONSTRAINT "exampapercourse_exam_paper_id_fkey" FOREIGN KEY ("exam_paper_id") REFERENCES "public"."exampaper" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table exampaperquestion
-- ----------------------------
ALTER TABLE "public"."exampaperquestion" ADD CONSTRAINT "exampaperquestion_exam_paper_id_fkey" FOREIGN KEY ("exam_paper_id") REFERENCES "public"."exampaper" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."exampaperquestion" ADD CONSTRAINT "exampaperquestion_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."question" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table knowledgepoint
-- ----------------------------
ALTER TABLE "public"."knowledgepoint" ADD CONSTRAINT "knowledgepoint_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."trainingcourse" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table option
-- ----------------------------
ALTER TABLE "public"."option" ADD CONSTRAINT "option_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."question" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table question
-- ----------------------------
ALTER TABLE "public"."question" ADD CONSTRAINT "question_knowledge_point_id_fkey" FOREIGN KEY ("knowledge_point_id") REFERENCES "public"."knowledgepoint" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table user_profile
-- ----------------------------
ALTER TABLE "public"."user_profile" ADD CONSTRAINT "user_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
