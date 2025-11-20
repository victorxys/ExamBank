import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/axios';
import { Survey } from 'survey-react-ui';
import { Model } from 'survey-core';
import 'survey-core/survey-core.min.css';
import {
    Container,
    Card,
    CardContent,
    Typography,
    CircularProgress,
    Alert,
    Box
} from '@mui/material';
import { formatAddress } from '../utils/formatUtils';

const ExamResultDetailPage = () => {
    const { submissionId } = useParams();
    const [resultData, setResultData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [surveyModel, setSurveyModel] = useState(null);

    useEffect(() => {
        const fetchResultData = async () => {
            try {
                setLoading(true);
                const response = await api.get(`/form-data/${submissionId}`);
                const data = response.data;

                // --- NEW TOP-LEVEL DEBUG LOG ---
                console.log("[DEBUG] Raw API response data:", JSON.parse(JSON.stringify(data)));
                console.log("[DEBUG] associated_form_meta:", data.dynamic_form?.associated_form_meta);

                setResultData(data);

                // --- NEW PRE-CONDITION DEBUG LOG ---
                console.log("[DEBUG] Checking conditions:", {
                    hasData: !!data,
                    hasDynamicForm: !!(data && data.dynamic_form),
                    hasSurveyJsSchema: !!(data && data.dynamic_form && data.dynamic_form.surveyjs_schema),
                    hasJinshujuSchema: !!(data && data.dynamic_form && data.dynamic_form.jinshuju_schema)
                });

                if (data && data.dynamic_form && data.dynamic_form.surveyjs_schema) {
                    const surveyJsSchema = data.dynamic_form.surveyjs_schema;
                    const rawAnswers = data.data;
                    const model = new Model(surveyJsSchema);
                    model.mode = 'display';

                    // Check if this is a legacy jinshuju-synced form AND the data actually looks like legacy data (field_x keys)
                    const hasLegacySchema = !!data.dynamic_form.jinshuju_schema;
                    const hasLegacyDataKeys = rawAnswers && Object.keys(rawAnswers).some(key => key.startsWith('field_'));

                    console.log("[DEBUG] Legacy Check:", { hasLegacySchema, hasLegacyDataKeys });

                    if (hasLegacySchema && hasLegacyDataKeys) {
                        // --- EXISTING LOGIC FOR JINSHUJU DATA ---
                        const jinshujuSchema = data.dynamic_form.jinshuju_schema;

                        // 1. Build mapping from jinshuju: field_x -> label
                        const fieldMap = {};
                        jinshujuSchema.fields.forEach(fieldWrapper => {
                            for (const fieldId in fieldWrapper) {
                                if (fieldWrapper[fieldId].label) {
                                    fieldMap[fieldId] = fieldWrapper[fieldId].label;
                                }
                            }
                        });

                        // 2. Build reverse mapping: label -> field_x
                        const reverseFieldMap = {};
                        for (const fieldId in fieldMap) {
                            reverseFieldMap[fieldMap[fieldId]] = fieldId;
                        }

                        // 3. Build choice mapping: question_label -> { choice_text -> choice_value }
                        const choiceMap = {};
                        surveyJsSchema.pages.forEach(page => {
                            page.elements.forEach(question => {
                                if (question.choices) {
                                    choiceMap[question.name] = {};
                                    question.choices.forEach(choice => {
                                        choiceMap[question.name][choice.text] = choice.value;
                                    });
                                }
                            });
                        });

                        // 4. Transform raw answers to displayable data for SurveyJS
                        const displayData = {};

                        // DEBUG: Log raw answers keys
                        console.log("[DEBUG] Raw Answers Keys:", Object.keys(rawAnswers));
                        console.log("[DEBUG] Reverse Field Map:", reverseFieldMap);

                        surveyJsSchema.pages.forEach(page => {
                            page.elements.forEach(question => {
                                const questionName = question.name; // This is the label
                                const fieldId = reverseFieldMap[questionName];

                                // Look up field definition in Jinshuju schema if available
                                let fieldDef = null;
                                if (fieldId && data.dynamic_form.jinshuju_schema && data.dynamic_form.jinshuju_schema.fields) {
                                    const fieldEntry = data.dynamic_form.jinshuju_schema.fields.find(f => f[fieldId]);
                                    if (fieldEntry) fieldDef = fieldEntry[fieldId];
                                }

                                if (fieldId && rawAnswers[fieldId] !== undefined) {
                                    let userAnswer = rawAnswers[fieldId];

                                    // Handle Address Object (Explicit type check or value check)
                                    if ((fieldDef && fieldDef.type === 'address') ||
                                        (userAnswer && typeof userAnswer === 'object' && (userAnswer.province || userAnswer.city))) {
                                        userAnswer = formatAddress(userAnswer);
                                    }

                                    // Handle Form Association (Nested Forms)
                                    // Check if there are associated fields in rawAnswers
                                    // We check if field type is form_association OR if we find associated keys
                                    const associatedKeys = Object.keys(rawAnswers).filter(key => key.startsWith(`${fieldId} _associated_field_`));

                                    if ((fieldDef && fieldDef.type === 'form_association') || associatedKeys.length > 0) {
                                        console.log(`[DEBUG] Processing association for ${questionName}(${fieldId}).Keys: `, associatedKeys);

                                        if (associatedKeys.length > 0) {
                                            // Specific mapping for zQPXAn (Party A Info)
                                            // field_2: Name, field_3: Phone, field_4: ID, field_5: Address, field_16: Signature
                                            // 使用 API 返回的 associated_form_meta 动态获取字段标签
                                            const associatedMeta = data.dynamic_form.associated_form_meta?.[fieldId];
                                            const fieldLabels = {};

                                            if (associatedMeta && associatedMeta.fields) {
                                                // 构建字段标签映射
                                                Object.keys(associatedMeta.fields).forEach(fid => {
                                                    fieldLabels[fid] = associatedMeta.fields[fid].label;
                                                });
                                            }

                                            // Aggregate associated values
                                            // Sort keys numerically by the associated field ID
                                            associatedKeys.sort((a, b) => {
                                                const idA = parseInt(a.split('_associated_field_')[1]);
                                                const idB = parseInt(b.split('_associated_field_')[1]);
                                                return idA - idB;
                                            });

                                            const associatedValues = associatedKeys.map(key => {
                                                const val = rawAnswers[key];
                                                const subFieldId = key.split('_associated_field_')[1];

                                                // Skip if it's the same as the ID (often the first associated field is the ID itself)
                                                if (val == userAnswer) return null;

                                                let displayVal = val;
                                                // Fix: fieldLabels keys are like 'field_2', but subFieldId is just '2'
                                                let label = fieldLabels[`field_${subFieldId}`] || '';

                                                // Format if it's an address
                                                if (val && typeof val === 'object' && (val.province || val.city)) {
                                                    displayVal = formatAddress(val);
                                                } else if (typeof displayVal === 'string') {
                                                    displayVal = displayVal.trim();
                                                }

                                                // Handle Signature - check field type from metadata
                                                const fieldType = associatedMeta?.fields?.[`field_${subFieldId}`]?.type;
                                                if (fieldType === 'e_signature' ||
                                                    (typeof val === 'string' && (
                                                        (val.includes('jinshujufiles.com') && val.includes('signature')) ||
                                                        val.includes('/api/contracts/signatures/')
                                                    ))) {
                                                    return {
                                                        label,
                                                        value: `[SIGNATURE:${val}]`,
                                                        isSignature: true
                                                    };
                                                }

                                                return {
                                                    label,
                                                    value: displayVal,
                                                    isSignature: false
                                                };
                                            }).filter(Boolean);

                                            if (associatedValues.length > 0) {
                                                // Construct HTML block structure
                                                let html = '<div class="nested-form-container" style="padding: 5px 0;">';

                                                associatedValues.forEach(item => {
                                                    html += `<div class="nested-field-item" style="margin-bottom: 10px;">
                                                            <div class="nested-field-label" style="font-size: 14px; font-weight: bold; margin-bottom: 4px; color: #333;">${item.label}</div>
                                                            <div class="nested-field-value" style="background: #f9f9f9; padding: 8px 10px; border-radius: 4px; min-height: 20px; border: 1px solid #eee; color: #333; word-break: break-word; white-space: pre-wrap; line-height: 1.5;">${item.value}</div>
                                                        </div>`;
                                                });
                                                html += '</div>';
                                                userAnswer = html;
                                            }
                                        }
                                    }
                                    if (choiceMap[questionName]) { // It's a choice-based question
                                        const answerAsArray = Array.isArray(userAnswer) ? userAnswer : [userAnswer];

                                        const mappedValues = answerAsArray
                                            .map(text => choiceMap[questionName][text])
                                            .filter(Boolean); // Filter out any failed lookups

                                        if (question.type === 'checkbox') {
                                            displayData[questionName] = mappedValues; // Checkbox expects an array
                                        } else if (mappedValues.length > 0) {
                                            displayData[questionName] = mappedValues[0]; // Radiogroup/dropdown expects a single value
                                        }
                                    } else { // Simple text question
                                        displayData[questionName] = userAnswer;
                                    }
                                }
                            });
                        });
                        model.data = displayData;

                        // 5. Setup highlighting using the reverse map
                        model.onAfterRenderQuestion.add((survey, options) => {
                            const questionName = options.question.name;
                            const questionValue = options.question.value;
                            const fieldId = reverseFieldMap[questionName];

                            // Look up field definition again
                            let fieldDef = null;
                            if (fieldId && data.dynamic_form.jinshuju_schema && data.dynamic_form.jinshuju_schema.fields) {
                                const fieldEntry = data.dynamic_form.jinshuju_schema.fields.find(f => f[fieldId]);
                                if (fieldEntry) fieldDef = fieldEntry[fieldId];
                            }

                            // --- Handle Signature Display ---
                            // Check for special signature marker or standard signature field
                            const signatureMarker = '[SIGNATURE:';
                            const hasSignatureMarker = typeof questionValue === 'string' && questionValue.includes(signatureMarker);

                            // Check if this is a form_association field with multi-line content OR our new HTML structure
                            const isMultiLineAssociation = typeof questionValue === 'string' && (questionValue.includes('\n') || questionValue.includes('nested-form-container'));

                            if ((fieldDef && fieldDef.type === 'e_signature') ||
                                (typeof questionValue === 'string' && (
                                    (questionValue.includes('jinshujufiles.com') && questionValue.includes('signature')) ||
                                    questionValue.includes('/api/contracts/signatures/')
                                )) ||
                                hasSignatureMarker ||
                                isMultiLineAssociation) {

                                console.log(`[DEBUG] Rendering signature for ${questionName}`);

                                if (hasSignatureMarker || isMultiLineAssociation) {
                                    // Handle multi-line text with potential signature markers
                                    let htmlContent = questionValue;

                                    // Replace all signature markers with img tags
                                    const signatureRegex = /\[SIGNATURE:(https?:\/\/[^\]]+)\]/g;
                                    htmlContent = htmlContent.replace(signatureRegex, (match, url) => {
                                        return `<img src="${url}" class="signature-display" style="display: block; max-width: 200px; max-height: 100px; margin-top: 10px; border: 1px solid #eee;" alt="签名图片" />`;
                                    });

                                    // Convert newlines to br tags
                                    htmlContent = htmlContent.replace(/\n/g, '<br>');

                                    // Set the HTML content
                                    options.htmlElement.innerHTML = htmlContent;
                                } else {
                                    // Standard signature field logic (replace entire content)
                                    options.htmlElement.innerHTML = '';
                                    const img = document.createElement('img');
                                    img.src = questionValue;
                                    img.className = 'signature-display';
                                    img.style.cssText = 'display: block; max-width: 200px; max-height: 100px; margin-top: 10px; border: 1px solid #eee;';
                                    img.alt = '签名图片';
                                    options.htmlElement.appendChild(img);
                                }
                            }

                            if (!fieldId) return;

                            const existingCorrectAnswerDiv = options.htmlElement.querySelector('.correct-answer-display');
                            if (existingCorrectAnswerDiv) existingCorrectAnswerDiv.remove();

                            const existingScoreDiv = options.htmlElement.querySelector('.score-display');
                            if (existingScoreDiv) existingScoreDiv.remove();

                            // Only reset border/padding if we didn't just clear the content for signature
                            if (!options.htmlElement.querySelector('.signature-display')) {
                                options.htmlElement.style.borderLeft = '';
                                options.htmlElement.style.paddingLeft = '';
                            }

                            const extraValueKey = `${fieldId}_extra_value`;
                            const resultDetails = rawAnswers[extraValueKey];

                            if (resultDetails) {
                                const isCorrect = resultDetails.score !== null && resultDetails.score > 0;

                                options.htmlElement.style.paddingLeft = '10px';
                                options.htmlElement.style.borderLeft = isCorrect ? '5px solid #2dce89' : '5px solid #f5365c';

                                const scoreDiv = document.createElement('div');
                                scoreDiv.className = 'score-display';
                                scoreDiv.style.cssText = 'margin-top: 5px; font-weight: bold; color: ' + (isCorrect ? '#2dce89' : '#f5365c');
                                scoreDiv.innerHTML = `得分: ${resultDetails.score}`;
                                options.htmlElement.appendChild(scoreDiv);

                                if (!isCorrect) {
                                    const correctAnswerDiv = document.createElement('div');
                                    correctAnswerDiv.className = 'correct-answer-display';
                                    correctAnswerDiv.style.cssText = 'margin-top: 10px; padding: 10px; background-color: #f6f9fc; border: 1px solid #dee2e6; white-space: pre-wrap; word-break: break-word;';

                                    let correctAnswerText = resultDetails.correct_answer;
                                    if (Array.isArray(correctAnswerText)) {
                                        correctAnswerText = correctAnswerText.join(', ');
                                    }

                                    correctAnswerDiv.innerHTML = `<strong>正确答案:</strong> ${correctAnswerText || 'N/A'}`;
                                    options.htmlElement.appendChild(correctAnswerDiv);
                                }
                            }
                        });
                    } else {
                        // --- NEW LOGIC FOR NATIVE SURVEYJS DATA (OR HYBRID LEGACY SCHEMA + NEW DATA) ---
                        console.log("--- DEBUG: Handling Native SurveyJS Data ---");
                        console.log("Raw Answers from API:", JSON.parse(JSON.stringify(rawAnswers)));

                        // 1. Build a mapping from Question Title -> Question Name AND Name -> Title
                        const titleToNameMap = {};
                        const nameToTitleMap = {};
                        if (surveyJsSchema && surveyJsSchema.pages) {
                            surveyJsSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(element => {
                                        // Map title to name. If title is missing, SurveyJS uses name as title.
                                        const title = element.title || element.name;
                                        const name = element.name;

                                        titleToNameMap[title] = name;
                                        // Also map name to name in case data uses names
                                        titleToNameMap[name] = name;

                                        // Map name back to title for result_details lookup
                                        nameToTitleMap[name] = title;
                                    });
                                }
                            });
                        }
                        console.log("Title to Name Map:", titleToNameMap);
                        console.log("Name to Title Map:", nameToTitleMap);

                        // 2. Normalize the data
                        const normalizedData = {};

                        if (rawAnswers) {
                            Object.keys(rawAnswers).forEach(key => {
                                let value = rawAnswers[key];

                                // Handle Address Object
                                if (value && typeof value === 'object' && (value.province || value.city || value.district || value.street)) {
                                    value = formatAddress(value);
                                }

                                const mappedName = titleToNameMap[key];
                                if (mappedName) {
                                    normalizedData[mappedName] = value;
                                } else {
                                    // If no mapping found, keep original key (fallback)
                                    normalizedData[key] = value;
                                }
                            });
                        }

                        console.log("Normalized Data:", normalizedData);

                        model.data = normalizedData;

                        // NEW: Set correct answers on the model to enable native display
                        if (data.result_details) {
                            model.getAllQuestions().forEach(question => {
                                const questionName = question.name;
                                const questionTitle = nameToTitleMap[questionName];
                                // Look up in result_details. It could be keyed by Title or Name.
                                const resultDetail = data.result_details[questionTitle] || data.result_details[questionName];

                                if (resultDetail && resultDetail.correct_answer !== undefined) {
                                    question.correctAnswer = resultDetail.correct_answer;
                                }
                            });
                            // This tells SurveyJS to show checkmarks, crosses, and correct answers.
                            model.showCorrectAnswers = true;
                        }

                        // 3. Setup score display and signatures using onAfterRenderQuestion
                        model.onAfterRenderQuestion.add((survey, options) => {
                            const questionName = options.question.name;
                            const questionValue = options.question.value;

                            // --- Handle Signature Display ---
                            if (typeof questionValue === 'string' && questionValue.includes('jinshujufiles.com') && questionValue.includes('signature')) {
                                const existingImg = options.htmlElement.querySelector('.signature-display');
                                if (!existingImg) {
                                    const img = document.createElement('img');
                                    img.src = questionValue;
                                    img.className = 'signature-display';
                                    img.style.cssText = 'display: block; max-width: 200px; max-height: 100px; margin-top: 10px; border: 1px solid #eee;';
                                    options.htmlElement.appendChild(img);
                                }
                            }

                            // --- Handle Score Display ---
                            const questionTitle = nameToTitleMap[questionName];
                            let resultDetail = null;
                            if (data.result_details) {
                                resultDetail = data.result_details[questionTitle] || data.result_details[questionName];
                            }

                            if (resultDetail && resultDetail.points !== null) {
                                // Remove old feedback divs to prevent duplicates on re-render
                                const existingFeedback = options.htmlElement.querySelector('.question-feedback');
                                if (existingFeedback) existingFeedback.remove();

                                const feedbackDiv = document.createElement('div');
                                feedbackDiv.className = 'question-feedback';
                                // The native surveyjs result will be inside the question. Let's add our score below it.
                                feedbackDiv.style.cssText = 'margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;';

                                const earnedPoints = resultDetail.earned_points;
                                const totalPoints = resultDetail.points;

                                const scoreSpan = document.createElement('div');
                                scoreSpan.innerHTML = `<strong>得分:</strong> <span style="font-weight: bold; color: ${earnedPoints > 0 ? '#2dce89' : '#f5365c'};">${earnedPoints}</span> / ${totalPoints}`;
                                feedbackDiv.appendChild(scoreSpan);

                                options.htmlElement.appendChild(feedbackDiv);
                            }
                        });


                        console.log("SurveyJS Model after setting data:", model);
                        console.log("Data in model (model.data):", model.data);
                    }

                    setSurveyModel(model);
                }

            } catch (err) {
                console.error('获取结果详情失败:', err);
                setError(err.response?.data?.message || err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchResultData();
    }, [submissionId]);

    if (loading) {
        return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    }

    if (error) {
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载结果详情失败: {error}</Alert></Container>;
    }

    if (!resultData) {
        return <Container sx={{ mt: 4 }}><Alert severity="info">没有找到结果数据。</Alert></Container>;
    }

    return (
        <Container maxWidth="lg" sx={{ mt: 4 }}>
            <Card>
                <CardContent>
                    <Typography variant="h4" component="h1" gutterBottom>
                        {resultData.dynamic_form.name} - 答题详情
                    </Typography>
                    <Box sx={{ mb: 3, p: 2, backgroundColor: 'grey.100', borderRadius: 1 }}>
                        <Typography variant="h5">
                            总分: <span style={{ color: resultData.score >= 60 ? '#2dce89' : '#f5365c', fontWeight: 'bold' }}>
                                {resultData.score !== null ? resultData.score : '未评分'}
                            </span>
                        </Typography>
                        <Typography variant="body1" color="text.secondary">
                            提交时间: {new Date(resultData.created_at).toLocaleString()}
                        </Typography>
                    </Box>

                    {surveyModel && <Survey model={surveyModel} />}
                </CardContent>
            </Card>
        </Container>
    );
};

export default ExamResultDetailPage;
