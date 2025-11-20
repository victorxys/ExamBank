import React, { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom'; // 导入 useLocation
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import api from '../api/axios';
import {
    Container,
    CircularProgress,
    Alert,
    Box,
    Button,
    Typography
} from '@mui/material';
import { formatAddress } from '../utils/formatUtils';

const DynamicFormPage = () => {
    const { formToken, dataId } = useParams();
    const location = useLocation(); // 获取 location 对象
    const [surveyModel, setSurveyModel] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentMode, setCurrentMode] = useState('edit'); // 默认为编辑模式

    useEffect(() => {
        const fetchForm = async () => {
            try {
                setLoading(true);
                if (!formToken) {
                    throw new Error('Form token is missing.');
                }
                // 1. 获取表单 Schema
                const formResponse = await api.get(`/dynamic_forms/${formToken}`);
                const formSchema = formResponse.data.surveyjs_schema;

                if (!formSchema) {
                    throw new Error('未找到表单的 SurveyJS Schema');
                }

                const survey = new Model(formSchema);

                let initialMode = 'edit'; // 默认新表单为编辑模式

                // 2. 如果有 dataId，获取已存在的数据
                if (dataId) {
                    const dataResponse = await api.get(`/form-data/${dataId}`);
                    const rawData = dataResponse.data.data;
                    const jinshujuSchema = formResponse.data.jinshuju_schema;

                    // --- DATA COMPATIBILITY LOGIC START ---
                    // Check if this is a legacy jinshuju-synced form AND the data actually looks like legacy data (field_x keys)
                    const hasLegacySchema = !!jinshujuSchema;
                    const hasLegacyDataKeys = rawData && Object.keys(rawData).some(key => key.startsWith('field_'));

                    let displayData = rawData;

                    if (hasLegacySchema && hasLegacyDataKeys) {
                        // --- LEGACY LOGIC FOR JINSHUJU DATA ---

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
                        if (formSchema.pages) {
                            formSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(question => {
                                        if (question.choices) {
                                            choiceMap[question.name] = {};
                                            question.choices.forEach(choice => {
                                                choiceMap[question.name][choice.text] = choice.value;
                                            });
                                        }
                                    });
                                }
                            });
                        }

                        // 4. Transform raw answers to displayable data for SurveyJS
                        displayData = {};


                        if (formSchema.pages) {
                            formSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(question => {
                                        const questionName = question.name; // This is the label
                                        const fieldId = reverseFieldMap[questionName];

                                        // Look up field definition in Jinshuju schema if available
                                        let fieldDef = null;
                                        if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                            const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                            if (fieldEntry) fieldDef = fieldEntry[fieldId];
                                        }

                                        if (fieldId && rawData[fieldId] !== undefined) {
                                            let userAnswer = rawData[fieldId];

                                            // Handle Address Object
                                            if ((fieldDef && fieldDef.type === 'address') ||
                                                (userAnswer && typeof userAnswer === 'object' && (userAnswer.province || userAnswer.city))) {
                                                userAnswer = formatAddress(userAnswer);
                                            }

                                            const associatedKeys = Object.keys(rawData).filter(key => key.startsWith(`${fieldId}_associated_field_`));

                                            if ((fieldDef && fieldDef.type === 'form_association') || associatedKeys.length > 0) {
                                                if (associatedKeys.length > 0) {
                                                    // 使用 API 返回的 associated_form_meta 动态获取字段标签
                                                    const associatedMeta = formResponse.data.associated_form_meta?.[fieldId];

                                                    const fieldLabels = {};

                                                    if (associatedMeta && associatedMeta.fields) {
                                                        // 构建字段标签映射
                                                        Object.keys(associatedMeta.fields).forEach(fid => {
                                                            fieldLabels[fid] = associatedMeta.fields[fid].label;
                                                        });
                                                    }

                                                    console.log(`[DEBUG] fieldLabels:`, fieldLabels);
                                                    console.log(`[DEBUG] userAnswer (field_1 value):`, userAnswer);

                                                    // Sort keys numerically by the associated field ID
                                                    associatedKeys.sort((a, b) => {
                                                        const idA = parseInt(a.split('_associated_field_')[1]);
                                                        const idB = parseInt(b.split('_associated_field_')[1]);
                                                        return idA - idB;
                                                    });

                                                    const associatedValues = associatedKeys.map(key => {
                                                        const val = rawData[key];
                                                        const subFieldId = key.split('_associated_field_')[1];

                                                        if (val == userAnswer) return null;

                                                        let displayVal = val;
                                                        // Fix: fieldLabels keys are like 'field_2', but subFieldId is just '2'
                                                        let label = fieldLabels[`field_${subFieldId}`] || '';

                                                        if (val && typeof val === 'object' && (val.province || val.city)) {
                                                            displayVal = formatAddress(val);
                                                        } else if (typeof displayVal === 'string') {
                                                            displayVal = displayVal.trim();
                                                        }

                                                        // 检查是否是签名字段
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

                                                        // Add main title if needed (though SurveyJS usually handles it, adding a class allows us to control it)
                                                        // html += `<h4 class="nested-form-title" style="margin-bottom: 15px; font-weight: bold;">${questionName}</h4>`;

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
                                                console.log(`[DEBUG] Setting displayData[${questionName}] = `, userAnswer);
                                                displayData[questionName] = userAnswer;
                                            }
                                        }
                                    });
                                }
                            });
                        }

                        // Add Signature Rendering Logic
                        survey.onAfterRenderQuestion.add((sender, options) => {
                            const questionName = options.question.name;
                            const questionValue = options.question.value;
                            const fieldId = reverseFieldMap[questionName];

                            let fieldDef = null;
                            if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                if (fieldEntry) fieldDef = fieldEntry[fieldId];
                            }

                            // Only render image if in display mode OR if it's clearly a signature URL
                            if (sender.mode === 'display') {
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
                                        // Simple signature image (no multi-line content)
                                        options.htmlElement.innerHTML = '';
                                        const img = document.createElement('img');
                                        img.src = questionValue;
                                        img.className = 'signature-display';
                                        img.style.cssText = 'display: block; max-width: 200px; max-height: 100px; margin-top: 10px; border: 1px solid #eee;';
                                        img.alt = '签名图片';
                                        options.htmlElement.appendChild(img);
                                    }
                                }
                            }
                        });
                    } else {
                        // --- NEW LOGIC FOR NATIVE SURVEYJS DATA (OR HYBRID) ---
                        console.log("[DEBUG] Using Native/Hybrid Mapping");

                        // 1. Build a mapping from Question Title -> Question Name
                        const titleToNameMap = {};
                        if (formSchema && formSchema.pages) {
                            formSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(element => {
                                        // Map title to name. If title is missing, SurveyJS uses name as title.
                                        if (element.title) {
                                            titleToNameMap[element.title] = element.name;
                                        }
                                        titleToNameMap[element.name] = element.name;
                                    });
                                }
                            });
                        }

                        // 2. Normalize the data
                        displayData = {};
                        if (rawData) {
                            Object.keys(rawData).forEach(key => {
                                const mappedName = titleToNameMap[key];
                                if (mappedName) {
                                    displayData[mappedName] = rawData[key];
                                } else {
                                    // If no mapping found, keep original key (fallback)
                                    displayData[key] = rawData[key];
                                }
                            });
                        }
                    }
                    // --- DATA COMPATIBILITY LOGIC END ---

                    survey.data = displayData;

                    // 检查 URL 查询参数，例如 /forms/:formToken/:dataId?mode=edit
                    const queryParams = new URLSearchParams(location.search);
                    if (queryParams.get('mode') === 'edit') {
                        initialMode = 'edit';
                    } else {
                        initialMode = 'display'; // 默认查看模式
                    }
                }

                setCurrentMode(initialMode); // 设置初始模式
                survey.mode = initialMode; // 应用到 SurveyJS 模型

                // 3. 设置 onComplete 回调
                survey.onComplete.add(async (sender) => {
                    const formData = sender.data;
                    try {
                        if (dataId) {
                            // 更新数据
                            await api.patch(`/form-data/${dataId}`, { data: formData });
                            alert('表单更新成功！');
                            setCurrentMode('display'); // 更新后切换到查看模式
                        } else {
                            // 提交新数据
                            const newRecord = await api.post(`/form-data/submit/${formResponse.data.id}`, { data: formData });
                            alert('表单提交成功！');
                            // 可选：提交后跳转到新纪录的详情页
                            // history.push(`/forms/${formToken}/${newRecord.data.id}`);
                        }
                    }
                    catch (err) {
                        console.error('提交表单失败:', err);
                        alert(`提交失败: ${err.response?.data?.message || err.message}`);
                    }
                });

                setSurveyModel(survey);
            }
            catch (err) {
                console.error('加载表单失败:', err);
                setError(err.response?.data?.message || err.message);
            }
            finally {
                setLoading(false);
            }
        };

        fetchForm();
    }, [formToken, dataId, location.search]); // 依赖项中添加 location.search

    // 切换模式的函数
    const toggleMode = () => {
        const newMode = currentMode === 'display' ? 'edit' : 'display';
        setCurrentMode(newMode);
        if (surveyModel) {
            surveyModel.mode = newMode;
        }
    };

    if (loading) {
        return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    }

    if (error) {
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载表单失败: {error}</Alert></Container>;
    }

    if (!surveyModel) {
        return <Container sx={{ mt: 4 }}><Alert severity="warning">无法加载表单模型。</Alert></Container>;
    }

    return (
        <Container maxWidth="md" sx={{ mt: 4 }}>
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h5" component="h1">
                    {dataId ? (currentMode === 'display' ? '查看表单数据' : '编辑表单数据') : '填写新表单'}
                </Typography>
                {dataId && ( // 只有在查看/编辑现有数据时才显示切换按钮
                    <Button variant="outlined" onClick={toggleMode}>
                        切换到 {currentMode === 'display' ? '编辑模式' : '查看模式'}
                    </Button>
                )}
            </Box>
            <Survey model={surveyModel} />
        </Container>
    );
};

export default DynamicFormPage;

