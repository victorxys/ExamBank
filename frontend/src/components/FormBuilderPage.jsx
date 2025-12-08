console.log("FORM BUILDER FILE IS LOADING - HIDING CORRECT ANSWER"); // DO NOT REMOVE THIS LINE

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SurveyCreatorComponent, SurveyCreator } from 'survey-creator-react';
import { editorLocalization } from 'survey-creator-core';
import * as Survey from 'survey-core'; // 修正：'as' 代替 '=>'
import 'survey-core/survey-core.min.css';
import 'survey-creator-core/survey-creator-core.min.css';
import 'survey-creator-core/i18n/simplified-chinese';
import api from '../api/axios';
import {
    Container,
    CircularProgress,
    Alert,
    Box,
    Typography,
    TextField,
    FormControlLabel,
    Switch
} from '@mui/material';

// --- 全局配置 ---
editorLocalization.currentLocale = "zh-cn";

Survey.Serializer.addProperty("question", { name: "points:number", displayName: "题目分值", category: "general", visibleIndex: 0, default: 1 });
const correctAnswerProp = Survey.Serializer.getProperty("question", "correctAnswer");
if (correctAnswerProp) {
    correctAnswerProp.category = "general";
    correctAnswerProp.visibleIndex = 1;
}
Survey.Serializer.addProperty("itemvalue", { name: "score:number", displayName: "选项分数", type: "number", default: 0 });
Survey.Serializer.addProperty("itemvalue", {
    name: "isCorrect:boolean",
    displayName: "正确答案",
    category: "general",
    default: false,
    visible: false, // <--- 修正:这里将其设为不可见
    onGetValue: function (obj) {
        if (!obj || !obj.owner) return false;
        const question = obj.owner;
        const correctAnswer = question.correctAnswer;
        // 修复: 使用简单的 null/undefined 检查替代 Survey.Helpers.isNoValue
        if (correctAnswer === null || correctAnswer === undefined) return false;
        if (Array.isArray(correctAnswer)) {
            return correctAnswer.indexOf(obj.value) !== -1;
        }
        return correctAnswer == obj.value;
    },
    onSetValue: function (obj, value) {
        if (!obj || !obj.owner) return;
        const question = obj.owner;
        if (question.getType() === "radiogroup" || question.getType() === "dropdown") {
            question.correctAnswer = value ? obj.value : undefined;
        } else if (question.getType() === "checkbox") {
            let correctAnswer = question.correctAnswer;
            // 修复: 使用简单的 null/undefined 检查替代 Survey.Helpers.isNoValue
            if (correctAnswer === null || correctAnswer === undefined) correctAnswer = [];
            else if (!Array.isArray(correctAnswer)) correctAnswer = [correctAnswer];
            const index = correctAnswer.indexOf(obj.value);
            if (value) {
                if (index < 0) question.correctAnswer = [...correctAnswer, obj.value];
            } else {
                if (index > -1) {
                    const newArr = [...correctAnswer];
                    newArr.splice(index, 1);
                    question.correctAnswer = newArr.length > 0 ? newArr : undefined;
                }
            }
        }
    }
});

const creatorOptions = {
    showLogicTab: true,
    showTranslationTab: true,
    showJSONEditorTab: true
};

const FormBuilderPage = () => {
    const { formToken } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [examProperties, setExamProperties] = useState({ passing_score: null, exam_duration: null });
    const [isExam, setIsExam] = useState(false);
    const isExamRef = useRef(isExam);
    const creatorRef = useRef(null);

    useEffect(() => {
        isExamRef.current = isExam;
    }, [isExam]);
    useEffect(() => {
        const creator = new SurveyCreator(creatorOptions);
        creatorRef.current = creator;

        creator.onShowingProperty.add((sender, options) => {
            if (options.property.name === "points" || options.property.name === "correctAnswer") {
                options.canShow = isExamRef.current;
            }
        });

        creator.saveSurveyFunc = async (saveNo, callback) => {
            console.log('[FormBuilder] saveSurveyFunc 被调用, saveNo:', saveNo);
            const schema = creator.JSON;
            console.log('[FormBuilder] 准备保存的 schema:', schema);
            console.log('[FormBuilder] schema.pages 数量:', schema.pages?.length);

            try {
                const payload = {
                    surveyjs_schema: schema,
                    form_type: isExamRef.current ? "EXAM" : "QUESTIONNAIRE",
                    passing_score: isExamRef.current ? examProperties.passing_score : null,
                    exam_duration: isExamRef.current ? examProperties.exam_duration : null,
                };
                console.log('[FormBuilder] 发送 payload:', payload);

                if (formToken) {
                    console.log('[FormBuilder] 获取表单信息, formToken:', formToken);
                    const formResponse = await api.get(`/dynamic_forms/${formToken}`);
                    console.log('[FormBuilder] 表单 ID:', formResponse.data.id);
                    await api.patch(`/dynamic_forms/${formResponse.data.id}`, payload);
                    console.log('[FormBuilder] PATCH 请求完成');
                    alert('表单更新成功！');
                } else {
                    const name = prompt("请输入表单名称:", "新表单");
                    if (!name) { callback(saveNo, false); return; }
                    const description = prompt("请输入表单描述:", "");
                    await api.post('/dynamic_forms/', { ...payload, name, description });
                    alert('表单创建成功！');
                    navigate('/forms');
                }
                callback(saveNo, true);
            } catch (err) {
                console.error('保存表单失败:', err);
                alert(`保存失败: ${err.response?.data?.message || err.message}`);
                callback(saveNo, false);
            }
        };

        const loadForm = async () => {
            try {
                if (formToken) {
                    const response = await api.get(`/dynamic_forms/${formToken}`);
                    const { surveyjs_schema, form_type, passing_score, exam_duration } = response.data;
                    const isExamMode = form_type === "EXAM";
                    if (isExamMode) {
                        setIsExam(true);
                        setExamProperties({ passing_score, exam_duration });
                    }
                    creator.JSON = surveyjs_schema || {};
                    if (creator.survey) creator.survey.showCorrectAnswer = isExamMode;
                }
                setLoading(false);
            } catch (err) {
                setError(err.response?.data?.message || err.message);
                setLoading(false);
            }
        };

        loadForm();
    }, [formToken, navigate]);

    useEffect(() => {
        const creator = creatorRef.current;
        if (!creator) return;

        if (creator.survey) {
            creator.survey.showCorrectAnswer = isExam;
        }

        const pointsProp = Survey.Serializer.findProperty("question", "points");
        if (pointsProp) pointsProp.visible = isExam;

        const itemScoreProp = Survey.Serializer.findProperty("itemvalue", "score");
        if (itemScoreProp) itemScoreProp.visible = isExam;

        // itemCorrectProp 的动态可见性控制已移除，因为现在将其永久隐藏。

    }, [isExam]);

    if (loading) return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    if (error) return <Container sx={{ mt: 4 }}><Alert severity="error">{error}</Alert></Container>;

    return (
        <Box sx={{ height: 'calc(120vh - 70.4px)', width: 'calc(100%+18px)', margin: '-20px' }}>
            <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', backgroundColor: '#f7f7f7', borderBottom: '1px solid #e0e0e0' }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={isExam}
                            onChange={(e) => setIsExam(e.target.checked)}
                            name="isExam"
                            color="primary"
                        />
                    }
                    label={<Typography sx={{ fontWeight: 'bold' }}>是否为考试</Typography>}
                />
                {isExam && (
                    <>
                        <TextField
                            label="及格分数"
                            type="number"
                            value={examProperties.passing_score || ''}
                            onChange={(e) => setExamProperties({ ...examProperties, passing_score: parseInt(e.target.value) || null })}
                            inputProps={{ min: 0 }}
                            sx={{ width: 120 }}
                            size="small"
                        />
                        <TextField
                            label="考试时长 (分钟)"
                            type="number"
                            value={examProperties.exam_duration || ''}
                            onChange={(e) => setExamProperties({ ...examProperties, exam_duration: parseInt(e.target.value) || null })}
                            inputProps={{ min: 1 }}
                            sx={{ width: 150 }}
                            size="small"
                        />
                    </>
                )}
            </Box>
            <SurveyCreatorComponent creator={creatorRef.current} />
        </Box>
    );
};

export default FormBuilderPage;
