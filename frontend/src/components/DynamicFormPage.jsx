import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for Portals
import { useParams, useLocation } from 'react-router-dom'; // 导入 useLocation
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import '../styles/survey-theme-fresh.css'; // Import Fresh Vitality Theme
// Import Chinese language pack
import 'survey-core/i18n/simplified-chinese';

// Note: Language will be set on each survey instance
import api from '../api/axios';
import {
    Container,
    CircularProgress,
    Alert,
    Box,
    Button,
    Typography,
    IconButton
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { formatAddress } from '../utils/formatUtils';

// Portal Component to render buttons in the SurveyJS header
const HeaderButtonsPortal = ({ currentMode, toggleMode, formToken, dataId, api }) => {
    const [container, setContainer] = useState(null);

    useEffect(() => {
        // Find the target container (SurveyJS header)
        // We use a timer to ensure the element exists after SurveyJS renders
        const findContainer = () => {
            const el = document.querySelector('.sd-container-modern__title');
            if (el) {
                // Check if we already added a button container
                let btnContainer = el.querySelector('.custom-header-buttons');
                if (!btnContainer) {
                    btnContainer = document.createElement('div');
                    btnContainer.className = 'custom-header-buttons';
                    // Style it to float right or absolute position
                    btnContainer.style.cssText = 'position: absolute; right: 20px; top: 50%; transform: translateY(-50%); z-index: 10; display: flex; gap: 10px;';
                    el.appendChild(btnContainer);
                }
                setContainer(btnContainer);
            } else {
                // Retry if not found yet
                requestAnimationFrame(findContainer);
            }
        };

        findContainer();

        return () => {
            // Cleanup if needed (though SurveyJS re-renders might handle it)
        };
    }, []);

    if (!container) return null;

    return ReactDOM.createPortal(
        <>
            {formToken === 'N0Il9H' && (
                <Button
                    variant="contained"
                    color="secondary"
                    size="small"
                    onClick={async () => {
                        if (!window.confirm('确定要根据当前表单数据创建/更新员工信息吗？')) return;
                        try {
                            const res = await api.post(`/staff/create-from-form/${dataId}`);
                            alert(res.data.message);
                        } catch (err) {
                            console.error(err);
                            alert('操作失败: ' + (err.response?.data?.message || err.message));
                        }
                    }}
                    sx={{
                        backgroundColor: 'white',
                        color: 'secondary.main',
                        '&:hover': { backgroundColor: '#f3f4f6' }
                    }}
                >
                    创建员工信息
                </Button>
            )}
            <Button
                variant="outlined"
                size="small"
                onClick={toggleMode}
                sx={{
                    color: 'white',
                    borderColor: 'white',
                    '&:hover': {
                        borderColor: 'white',
                        backgroundColor: 'rgba(255,255,255,0.1)'
                    }
                }}
            >
                切换到 {currentMode === 'admin_view' ? '编辑模式' : '查看模式'}
            </Button>
        </>,
        container
    );
};

const DynamicFormPage = () => {
    const { formToken, dataId } = useParams();
    const location = useLocation(); // 获取 location 对象
    const [surveyModel, setSurveyModel] = useState(null);
    const [submissionState, setSubmissionState] = useState('idle'); // 'idle', 'submitting', 'completed'
    const [scoreResult, setScoreResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentMode, setCurrentMode] = useState('admin_view'); // 默认为编辑模式

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

                // Set Chinese locale for the survey
                survey.locale = "zh-cn";

                // Force storeDataAsText to false for all file questions to ensure we store the URL, not Base64
                survey.getAllQuestions().forEach(question => {
                    if (question.getType() === 'file') {
                        question.storeDataAsText = false;
                    }
                });

                // Add eye icon for private fields (visible: false in schema)
                survey.onAfterRenderQuestion.add((sender, options) => {
                    const question = options.question;
                    // Check if field was originally marked as not visible in schema
                    // (In detail view, all fields are shown, so we need to check the original schema)
                    const originalQuestion = formSchema.pages?.[0]?.elements?.find(el => el.name === question.name);
                    if (originalQuestion && originalQuestion.visible === false) {
                        const titleElement = options.htmlElement.querySelector('.sd-question__title');
                        if (titleElement && !titleElement.querySelector('.private-field-icon')) {
                            const icon = document.createElement('span');
                            icon.className = 'private-field-icon';
                            icon.innerHTML = `
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-left: 8px; color: #6b7280;">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                            `;
                            icon.title = '此字段仅管理员可见';
                            icon.style.cssText = 'cursor: help; display: inline-flex; align-items: center;';
                            titleElement.appendChild(icon);
                        }
                    }
                });

                // Beautify table (matrixdynamic) display
                survey.onAfterRenderQuestion.add((sender, options) => {
                    const question = options.question;
                    if (question.getType() === 'matrixdynamic' || question.getType() === 'matrixdropdown') {
                        setTimeout(() => {
                            // Handle textareas
                            const textareas = options.htmlElement.querySelectorAll('textarea');
                            textareas.forEach(textarea => {
                                // In display mode, replace textarea with plain text div
                                if (sender.mode === 'display' && textarea.disabled) {
                                    const textContent = textarea.value || '';
                                    const textDiv = document.createElement('div');
                                    textDiv.textContent = textContent;
                                    textDiv.style.cssText = 'padding: 0.5rem 0; line-height: 1.5; color: #374151; white-space: pre-wrap; word-break: break-word;';
                                    textarea.parentNode.replaceChild(textDiv, textarea);
                                } else if (!textarea.disabled) {
                                    // In edit mode, enable auto-resize
                                    const autoResize = () => {
                                        textarea.style.height = 'auto';
                                        textarea.style.height = textarea.scrollHeight + 'px';
                                    };
                                    autoResize();
                                    textarea.addEventListener('input', autoResize);
                                    const observer = new MutationObserver(autoResize);
                                    observer.observe(textarea, { attributes: true, attributeFilter: ['value'] });
                                }
                            });

                            // Remove padding from cells containing file upload - more aggressive approach
                            const removeFileCellPadding = () => {
                                const allCells = options.htmlElement.querySelectorAll('.sd-table__cell, td');

                                let fileCount = 0;
                                allCells.forEach(cell => {
                                    const hasFile = cell.querySelector('.sd-file, .sd-file__decorator, .sd-question--file');
                                    if (hasFile) {
                                        fileCount++;

                                        cell.style.setProperty('padding', '0', 'important');
                                        cell.style.setProperty('margin', '0', 'important');


                                        // Also remove padding from any wrapper elements
                                        const wrappers = cell.querySelectorAll('.sd-question, .sd-question__content');
                                        wrappers.forEach(wrapper => {
                                            wrapper.style.setProperty('padding', '0', 'important');
                                            wrapper.style.setProperty('margin', '0', 'important');
                                        });
                                    }
                                });

                            };

                            // Initial removal
                            removeFileCellPadding();

                            // Watch for dynamic changes
                            const observer = new MutationObserver(removeFileCellPadding);
                            observer.observe(options.htmlElement, {
                                childList: true,
                                subtree: true
                            });
                        }, 100); // Increased timeout
                    }
                });

                // Enable HTML rendering for form description
                survey.onAfterRenderHeader.add((sender, options) => {
                    // Find the description element. SurveyJS uses .sd-description (V2) or .sv-description (V1)
                    const descriptionEl = options.htmlElement.querySelector(".sd-description") || options.htmlElement.querySelector(".sv-description");
                    if (descriptionEl && sender.description) {
                        descriptionEl.innerHTML = sender.description;
                    }
                });

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
                                        const questionName = question.name; // This is usually the label in our generated schemas
                                        let fieldId = null;

                                        // Priority 1: If the question name itself is a field_x ID, use it directly.
                                        // This allows us to manually override mappings in the SurveyJS schema (e.g. for form Iqltzj).
                                        if (questionName.startsWith('field_')) {
                                            fieldId = questionName;
                                        }

                                        // Priority 2: Try matching by Name (Label)
                                        if (!fieldId) {
                                            fieldId = reverseFieldMap[questionName];
                                        }

                                        // Priority 3: Try matching by Title (Label) if Name didn't work
                                        if (!fieldId && question.title) {
                                            fieldId = reverseFieldMap[question.title];
                                        }

                                        // Look up field definition in Jinshuju schema if available
                                        let fieldDef = null;
                                        if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                            const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                            if (fieldEntry) fieldDef = fieldEntry[fieldId];
                                        }

                                        if (fieldId && rawData[fieldId] !== undefined) {
                                            let userAnswer = rawData[fieldId];

                                            // Normalize file objects if this is a file field with nested content structure
                                            // Check if userAnswer is an array of file objects with nested content
                                            if (Array.isArray(userAnswer) && userAnswer.length > 0) {
                                                const firstItem = userAnswer[0];
                                                // Check if it looks like a file object with nested content
                                                if (firstItem && typeof firstItem === 'object' &&
                                                    firstItem.content && typeof firstItem.content === 'object' &&
                                                    firstItem.content.content) {
                                                    console.log(`[File normalization] Detected nested content structure in ${fieldId}, normalizing...`);
                                                    userAnswer = userAnswer.map(fileObj => {
                                                        if (fileObj && typeof fileObj === 'object' &&
                                                            fileObj.content && typeof fileObj.content === 'object' &&
                                                            fileObj.content.content) {
                                                            console.log(`[File normalization] Flattening:`, fileObj);
                                                            return {
                                                                content: fileObj.content.content,
                                                                name: fileObj.content.name || fileObj.name || "image.jpg",
                                                                type: fileObj.content.type || fileObj.type || "image/jpeg"
                                                            };
                                                        }
                                                        return fileObj;
                                                    });
                                                    console.log(`[File normalization] Normalized ${fieldId}:`, userAnswer);
                                                }
                                            }

                                            // Handle Address Object
                                            if ((fieldDef && fieldDef.type === 'address') ||
                                                (userAnswer && typeof userAnswer === 'object' && (userAnswer.province || userAnswer.city))) {
                                                userAnswer = formatAddress(userAnswer);
                                            }

                                            const associatedKeys = Object.keys(rawData).filter(key => key.startsWith(`${fieldId}_associated_field_`));

                                            // Check if association fields are already expanded in surveyjs_schema
                                            let isExpanded = false;
                                            if (formSchema && formSchema.pages) {
                                                formSchema.pages.forEach(page => {
                                                    if (page.elements) {
                                                        const hasAssociatedElements = page.elements.some(el =>
                                                            el.name && el.name.startsWith(`${fieldId}_associated_field_`)
                                                        );
                                                        if (hasAssociatedElements) {
                                                            isExpanded = true;
                                                        }
                                                    }
                                                });
                                            }

                                            // Only generate HTML if NOT expanded in schema
                                            if (((fieldDef && fieldDef.type === 'form_association') || associatedKeys.length > 0) && !isExpanded) {
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
                                                                ((val.includes('jinshujufiles.com') || val.includes('mengyimengsao.com')) && val.includes('signature')) ||
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

                                                // Build reverse map (value -> value) for checking if data is already a value
                                                const choiceValues = Object.values(choiceMap[questionName]);

                                                const mappedValues = answerAsArray
                                                    .map(item => {
                                                        // If item is already a valid choice value, use it directly
                                                        if (choiceValues.includes(item)) {
                                                            return item;
                                                        }
                                                        // Otherwise, try to map from text to value
                                                        return choiceMap[questionName][item];
                                                    })
                                                    .filter(Boolean); // Filter out any failed lookups

                                                if (question.type === 'checkbox') {
                                                    displayData[questionName] = mappedValues; // Checkbox expects an array
                                                } else if (mappedValues.length > 0) {
                                                    displayData[questionName] = mappedValues[0]; // Radiogroup/dropdown expects a single value
                                                }
                                            } else if (question.type === 'file') {
                                                // Handle file uploads (convert URL strings to SurveyJS file objects)
                                                // Also handle nested content objects from backend

                                                // Helper function to normalize a single file object
                                                const normalizeFileObject = (fileObj) => {
                                                    // If it's already a string URL, convert to file object
                                                    if (typeof fileObj === 'string') {
                                                        let name = "image.jpg";
                                                        try {
                                                            const urlObj = new URL(fileObj);
                                                            const params = new URLSearchParams(urlObj.search);
                                                            if (params.has('attname')) {
                                                                name = params.get('attname');
                                                            } else {
                                                                name = urlObj.pathname.split('/').pop();
                                                            }
                                                        } catch (e) {
                                                            // ignore invalid URLs
                                                        }
                                                        return {
                                                            name: name,
                                                            type: "image/jpeg",
                                                            content: fileObj
                                                        };
                                                    }

                                                    // If it's an object, check for nested content structure
                                                    if (typeof fileObj === 'object' && fileObj !== null) {
                                                        // Check if content is nested: { content: { content: "url", name: "...", type: "..." } }
                                                        if (fileObj.content && typeof fileObj.content === 'object' && fileObj.content.content) {
                                                            console.log('[File normalization] Flattening nested content for file field:', fileObj);
                                                            return {
                                                                content: fileObj.content.content,
                                                                name: fileObj.content.name || fileObj.name || "image.jpg",
                                                                type: fileObj.content.type || fileObj.type || "image/jpeg"
                                                            };
                                                        }
                                                        // Already in correct format
                                                        return fileObj;
                                                    }

                                                    return fileObj;
                                                };

                                                if (Array.isArray(userAnswer)) {
                                                    displayData[questionName] = userAnswer.map(normalizeFileObject);
                                                } else if (userAnswer) {
                                                    displayData[questionName] = [normalizeFileObject(userAnswer)];
                                                }
                                            } else if (question.type === 'matrixdynamic') {
                                                // Handle matrixdynamic (table) data
                                                // Data from DB uses Chinese labels as keys, but schema uses field_X
                                                // Need to transform: {"类别": "xxx"} -> {"field_2": "xxx"}

                                                if (Array.isArray(userAnswer) && userAnswer.length > 0) {
                                                    // Get column definitions from schema
                                                    const columns = question.columns || [];

                                                    // Build mapping: Chinese label -> field_X
                                                    const labelToFieldMap = {};
                                                    columns.forEach(col => {
                                                        labelToFieldMap[col.title] = col.name;
                                                    });

                                                    // Transform each row
                                                    const transformedData = userAnswer.map(row => {
                                                        const newRow = {};
                                                        Object.keys(row).forEach(key => {
                                                            const fieldName = labelToFieldMap[key] || key;
                                                            newRow[fieldName] = row[key];
                                                        });
                                                        return newRow;
                                                    });

                                                    displayData[questionName] = transformedData;
                                                    console.log(`[DEBUG] Transformed matrixdynamic data for ${questionName}:`, transformedData);
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            } else if (question.type === 'matrixdropdown') {
                                                // Transform Jinshuju matrix data to SurveyJS matrixdropdown format
                                                // Jinshuju: [{ statement: 'row_val', dimensions: { col_key: 'val' } }]
                                                // SurveyJS: { 'row_val': { 'col_key': 'val' } }

                                                if (Array.isArray(userAnswer)) {
                                                    const transformedData = {};
                                                    userAnswer.forEach(item => {
                                                        // Use statement value as row key
                                                        let rowKey = item.statement;

                                                        // Try to map statement text to row value if possible
                                                        if (rowKey && question.rows) {
                                                            const rowDef = question.rows.find(r => r.text === rowKey || r.value === rowKey);
                                                            if (rowDef) {
                                                                rowKey = rowDef.value;
                                                            }
                                                        }

                                                        // If rowKey is empty, try to find a default row from question definition
                                                        if (!rowKey && question.rows && question.rows.length > 0) {
                                                            // If there's only one row, use it
                                                            if (question.rows.length === 1) {
                                                                rowKey = question.rows[0].value;
                                                            } else {
                                                                // If multiple rows, try to find one with empty value or specific marker
                                                                const emptyRow = question.rows.find(r => !r.value || r.value === "dQIl");
                                                                if (emptyRow) {
                                                                    rowKey = emptyRow.value;
                                                                } else {
                                                                    // Fallback to first row
                                                                    rowKey = question.rows[0].value;
                                                                }
                                                            }
                                                        }

                                                        // Map dimensions: Chinese Label -> Column Name (field_X)
                                                        const rowData = {};
                                                        const dimensions = item.dimensions || {};

                                                        // Get column mapping
                                                        const colMap = {};
                                                        if (question.columns) {
                                                            question.columns.forEach(col => {
                                                                colMap[col.title] = col.name;
                                                            });
                                                        }

                                                        Object.keys(dimensions).forEach(dimKey => {
                                                            // dimKey is likely the Chinese label (e.g., "合同编号")
                                                            // We need to map it to the column name (e.g., "field_1")
                                                            const colName = colMap[dimKey] || dimKey;
                                                            let cellValue = dimensions[dimKey];

                                                            // Check if this column is a dropdown and needs value mapping
                                                            if (question.columns) {
                                                                const colDef = question.columns.find(c => c.name === colName);
                                                                if (colDef && (colDef.cellType === 'dropdown' || colDef.choices)) {
                                                                    // Try to find the value corresponding to the text
                                                                    if (colDef.choices && cellValue) {
                                                                        const choice = colDef.choices.find(c => c.text === cellValue || c.value === cellValue);
                                                                        if (choice) {
                                                                            cellValue = choice.value;
                                                                        }
                                                                    }
                                                                }
                                                            }

                                                            rowData[colName] = cellValue;
                                                        });

                                                        if (rowKey) {
                                                            transformedData[rowKey] = rowData;
                                                        }
                                                    });
                                                    displayData[questionName] = transformedData;
                                                    console.log(`[DEBUG] Transformed matrixdropdown data for ${questionName}:`, transformedData);
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            } else if (question.type === 'matrix') {
                                                // Transform Jinshuju likert data to SurveyJS matrix format
                                                // Jinshuju: [{ choice: 'col_text', statement: 'row_text' }]
                                                // SurveyJS: { 'row_val': 'col_val' }
                                                if (Array.isArray(userAnswer)) {
                                                    const transformedData = {};
                                                    userAnswer.forEach(item => {
                                                        let rowKey = item.statement;
                                                        let colVal = item.choice;

                                                        // Map row text to row value
                                                        if (question.rows) {
                                                            const rowDef = question.rows.find(r => r.text === rowKey || r.value === rowKey);
                                                            if (rowDef) rowKey = rowDef.value;
                                                        }

                                                        // Map column text to column value
                                                        if (question.columns) {
                                                            const colDef = question.columns.find(c => c.text === colVal || c.value === colVal);
                                                            if (colDef) colVal = colDef.value;
                                                        }

                                                        if (rowKey) {
                                                            transformedData[rowKey] = colVal;
                                                        }
                                                    });
                                                    displayData[questionName] = transformedData;
                                                    console.log(`[DEBUG] Transformed matrix (likert) data for ${questionName}:`, transformedData);
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            } else if (question.type === 'rating') {
                                                // Handle rating type (simple value)
                                                displayData[questionName] = userAnswer;
                                                console.log(`[DEBUG] Setting rating data for ${questionName}:`, userAnswer);
                                            } else { // Simple text question
                                                console.log(`[DEBUG] Setting displayData[${questionName}] = `, userAnswer);
                                                // Handle empty values - show placeholder
                                                if (userAnswer === null || userAnswer === undefined || userAnswer === '') {
                                                    displayData[questionName] = '空';
                                                } else if (typeof userAnswer === 'object' && !Array.isArray(userAnswer)) {
                                                    // Handle object values - convert to JSON string
                                                    displayData[questionName] = JSON.stringify(userAnswer, null, 2);
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
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

                            // Try to get fieldId - if questionName is already field_X format, use it directly
                            let fieldId = questionName.match(/^field_\d+$/) ? questionName : reverseFieldMap[questionName];

                            let fieldDef = null;
                            if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                if (fieldEntry) fieldDef = fieldEntry[fieldId];
                            }

                            // Check if this is a signature field
                            const signatureMarker = '[SIGNATURE:';
                            const hasSignatureMarker = typeof questionValue === 'string' && questionValue.includes(signatureMarker);
                            const isMultiLineAssociation = typeof questionValue === 'string' && (questionValue.includes('\n') || questionValue.includes('nested-form-container'));

                            const isSignature = (fieldDef && fieldDef.type === 'e_signature') ||
                                (typeof questionValue === 'string' && (
                                    ((questionValue.includes('jinshujufiles.com') || questionValue.includes('mengyimengsao.com')) && questionValue.includes('signature')) ||
                                    questionValue.includes('/api/contracts/signatures/')
                                )) ||
                                hasSignatureMarker ||
                                isMultiLineAssociation;

                            // Force title rendering for HTML questions if not present
                            if (options.question.getType() === 'html') {
                                // Check if title exists
                                const titleEl = options.htmlElement.querySelector('.sd-question__title') || options.htmlElement.querySelector('.sv-question__title');
                                if (!titleEl && options.question.title) {
                                    const customTitle = document.createElement('h5');
                                    customTitle.className = 'sd-question__title sd-element__title';
                                    customTitle.style.cssText = 'margin: 0 0 10px 0; font-weight: bold; font-size: 16px; color: #404040;';
                                    customTitle.innerText = options.question.title;

                                    // Insert at the top
                                    options.htmlElement.insertBefore(customTitle, options.htmlElement.firstChild);
                                }
                            }

                            // Custom Rendering for File Questions
                            if (options.question.getType() === 'file') {
                                const questionValue = options.question.value;
                                const contentDiv = options.htmlElement.querySelector('.sd-question__content') || options.htmlElement;

                                // Prevent duplicate rendering
                                if (contentDiv.querySelector('.custom-file-carousel')) {
                                    return;
                                }

                                if (Array.isArray(questionValue) && questionValue.length > 0) {
                                    // Hide default preview
                                    const defaultPreview = contentDiv.querySelector('.sd-file');
                                    if (defaultPreview) {
                                        defaultPreview.style.display = 'none';
                                    }

                                    // Create Carousel Container
                                    const carouselContainer = document.createElement('div');
                                    carouselContainer.className = 'custom-file-carousel';
                                    carouselContainer.style.width = '100%';
                                    carouselContainer.style.display = 'flex';
                                    carouselContainer.style.flexDirection = 'column';
                                    carouselContainer.style.alignItems = 'center';
                                    carouselContainer.style.marginTop = '10px';
                                    carouselContainer.style.gap = '10px';

                                    // Image Display Area
                                    const imgDisplay = document.createElement('img');
                                    imgDisplay.style.maxWidth = '100%';
                                    imgDisplay.style.maxHeight = '800px';
                                    imgDisplay.style.objectFit = 'contain';
                                    imgDisplay.style.display = 'block';
                                    imgDisplay.style.cursor = 'pointer'; // Hint that it might be clickable (optional)

                                    // Open image in new tab on click
                                    imgDisplay.onclick = () => {
                                        window.open(imgDisplay.src, '_blank');
                                    };

                                    // Controls Container
                                    const controls = document.createElement('div');
                                    controls.style.display = 'flex';
                                    controls.style.alignItems = 'center';
                                    controls.style.gap = '20px';

                                    // Prev Button
                                    const prevBtn = document.createElement('button');
                                    prevBtn.innerText = '←';
                                    prevBtn.style.padding = '5px 15px';
                                    prevBtn.style.cursor = 'pointer';
                                    prevBtn.style.fontSize = '18px';

                                    // Next Button
                                    const nextBtn = document.createElement('button');
                                    nextBtn.innerText = '→';
                                    nextBtn.style.padding = '5px 15px';
                                    nextBtn.style.cursor = 'pointer';
                                    nextBtn.style.fontSize = '18px';

                                    // Counter
                                    const counter = document.createElement('span');
                                    counter.style.fontSize = '14px';
                                    counter.style.color = '#666';

                                    // State
                                    let currentIndex = 0;

                                    // Update Function
                                    const updateDisplay = () => {
                                        const file = questionValue[currentIndex];
                                        if (file && file.content) {
                                            imgDisplay.src = file.content;
                                            counter.innerText = `${currentIndex + 1} / ${questionValue.length}`;

                                            // Button states
                                            prevBtn.disabled = currentIndex === 0;
                                            nextBtn.disabled = currentIndex === questionValue.length - 1;
                                            prevBtn.style.opacity = currentIndex === 0 ? '0.5' : '1';
                                            nextBtn.style.opacity = currentIndex === questionValue.length - 1 ? '0.5' : '1';
                                        }
                                    };

                                    // Event Listeners
                                    prevBtn.onclick = (e) => {
                                        e.preventDefault(); // Prevent form submission or other side effects
                                        if (currentIndex > 0) {
                                            currentIndex--;
                                            updateDisplay();
                                        }
                                    };

                                    nextBtn.onclick = (e) => {
                                        e.preventDefault();
                                        if (currentIndex < questionValue.length - 1) {
                                            currentIndex++;
                                            updateDisplay();
                                        }
                                    };

                                    // Assemble Controls
                                    if (questionValue.length > 1) {
                                        controls.appendChild(prevBtn);
                                        controls.appendChild(counter);
                                        controls.appendChild(nextBtn);
                                    }

                                    // Initial Render
                                    updateDisplay();

                                    // Assemble Carousel
                                    carouselContainer.appendChild(imgDisplay);
                                    if (questionValue.length > 1) {
                                        carouselContainer.appendChild(controls);
                                    }

                                    // Append to DOM
                                    contentDiv.appendChild(carouselContainer);
                                }
                            }

                            if (isSignature) {
                                console.log(`[DEBUG] Rendering signature for ${questionName}`);

                                // Check if already wrapped
                                if (options.htmlElement.querySelector('.custom-signature-wrapper')) {
                                    return;
                                }

                                // Create styled wrapper
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-signature-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Add title
                                const titleDiv = document.createElement("div");
                                titleDiv.innerText = options.question.title || options.question.name;
                                titleDiv.style.cssText = "font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #404040;";
                                wrapper.appendChild(titleDiv);

                                // Add notes if available
                                if (fieldDef && fieldDef.notes) {
                                    const notesDiv = document.createElement("div");
                                    notesDiv.innerHTML = fieldDef.notes;
                                    notesDiv.style.cssText = "font-size: 12px; color: #666; margin-bottom: 8px; padding: 6px 8px; background-color: #f9f9f9; border-left: 3px solid #ffa500; border-radius: 2px;";
                                    wrapper.appendChild(notesDiv);
                                }

                                // Check if signature value is empty
                                const isEmptySignature = !questionValue || questionValue === '' || questionValue === '空';

                                if (isEmptySignature) {
                                    // Display empty placeholder
                                    const emptyDiv = document.createElement('div');
                                    emptyDiv.textContent = '空';
                                    emptyDiv.style.cssText = 'color: #999; font-style: italic; padding: 8px 0;';
                                    wrapper.appendChild(emptyDiv);
                                } else if (hasSignatureMarker || isMultiLineAssociation) {
                                    // Handle multi-line text with potential signature markers
                                    let htmlContent = questionValue;

                                    // Replace all signature markers with img tags
                                    const signatureRegex = /\[SIGNATURE:(https?:\/\/[^\]]+)\]/g;
                                    htmlContent = htmlContent.replace(signatureRegex, (match, url) => {
                                        return `<img src="${url}" class="signature-display" style="display: block; max-width: 200px; max-height: 100px;" alt="签名图片" />`;
                                    });

                                    // Convert newlines to br tags
                                    htmlContent = htmlContent.replace(/\n/g, '<br>');

                                    // Create content div
                                    const contentDiv = document.createElement('div');
                                    contentDiv.innerHTML = htmlContent;
                                    wrapper.appendChild(contentDiv);
                                } else {
                                    // Simple signature image
                                    const img = document.createElement('img');
                                    img.src = questionValue;
                                    img.className = 'signature-display';
                                    img.style.cssText = 'display: block; max-width: 200px; max-height: 100px;';
                                    img.alt = '签名图片';
                                    wrapper.appendChild(img);
                                }

                                // Clear and append wrapper
                                options.htmlElement.innerHTML = '';
                                options.htmlElement.appendChild(wrapper);
                            }

                            // Apply styling for html type questions (contract content) in Legacy mode
                            // DISABLED: This adds an unwanted border around HTML elements like section breaks
                            /*
                            if (options.question.getType() === "html") {
                                const container = options.htmlElement;

                                // Prevent double wrapping
                                if (container.querySelector('.custom-html-wrapper')) {
                                    return;
                                }

                                // Create a wrapper with consistent styling
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-html-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Move all children to the wrapper
                                while (container.firstChild) {
                                    wrapper.appendChild(container.firstChild);
                                }
                                container.appendChild(wrapper);
                            }
                            */
                        });
                    } else {
                        // --- NEW LOGIC FOR NATIVE SURVEYJS DATA (OR HYBRID) ---
                        console.log("[DEBUG] Using Native/Hybrid Mapping");

                        // Add custom rendering for signatures in Native/Hybrid mode
                        survey.onAfterRenderQuestion.add((sender, options) => {
                            const question = options.question;
                            const name = question.name;

                            // Apply generic styling for all image questions (signatures)
                            if (question.getType() === "image") {
                                // Apply custom styling to the question container
                                const container = options.htmlElement;

                                // Prevent double wrapping
                                if (container.querySelector('.custom-signature-wrapper')) {
                                    return;
                                }

                                // Create a wrapper with the requested style
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-signature-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Create title element using the question's dynamic title
                                const titleDiv = document.createElement("div");
                                titleDiv.innerText = question.title || question.name;
                                titleDiv.style.cssText = "font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #404040;";
                                wrapper.appendChild(titleDiv);

                                // Get fieldDef for notes
                                const questionName = question.name;
                                let fieldId = questionName.match(/^field_\d+$/) ? questionName : null;
                                let fieldDef = null;
                                if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                    const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                    if (fieldEntry) fieldDef = fieldEntry[fieldId];
                                }

                                // Add notes if available
                                if (fieldDef && fieldDef.notes) {
                                    const notesDiv = document.createElement("div");
                                    notesDiv.innerHTML = fieldDef.notes;
                                    notesDiv.style.cssText = "font-size: 12px; color: #666; margin-bottom: 8px; padding: 6px 8px; background-color: #f9f9f9; border-left: 3px solid #ffa500; border-radius: 2px;";
                                    wrapper.appendChild(notesDiv);
                                }

                                // Check if signature value is empty
                                const questionValue = question.value;
                                const isEmptySignature = !questionValue || questionValue === '' || questionValue === '空';

                                if (isEmptySignature) {
                                    // Display empty placeholder
                                    const emptyDiv = document.createElement('div');
                                    emptyDiv.textContent = '空';
                                    emptyDiv.style.cssText = 'color: #999; font-style: italic; padding: 8px 0;';
                                    wrapper.appendChild(emptyDiv);
                                } else {
                                    // Move all children of the original container to the wrapper
                                    while (container.firstChild) {
                                        wrapper.appendChild(container.firstChild);
                                    }
                                }
                                container.appendChild(wrapper);
                            }

                            // Apply styling for html type questions (contract content)
                            if (question.getType() === "html") {
                                const container = options.htmlElement;

                                // Prevent double wrapping
                                if (container.querySelector('.custom-html-wrapper')) {
                                    return;
                                }

                                // Create a wrapper with consistent styling
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-html-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Move all children to the wrapper
                                while (container.firstChild) {
                                    wrapper.appendChild(container.firstChild);
                                }
                                container.appendChild(wrapper);
                            }
                        });

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
                                const value = rawData[key];

                                // Handle empty values - show placeholder
                                const displayValue = (value === null || value === undefined || value === '') ? '空' : value;

                                if (mappedName) {
                                    displayData[mappedName] = displayValue;
                                } else {
                                    // If no mapping found, keep original key (fallback)
                                    displayData[key] = displayValue;
                                }
                            });
                        }
                    }
                    // --- DATA COMPATIBILITY LOGIC END ---

                    survey.data = displayData;

                    // --- NEW: Admin View Logic ---
                    // If we are viewing existing data (dataId present), we are likely in Admin View.
                    // We want to show hidden fields but make public fields read-only by default.

                    const allQuestions = survey.getAllQuestions();
                    const originalHiddenQuestions = [];

                    allQuestions.forEach(q => {
                        if (q.visible === false) {
                            originalHiddenQuestions.push(q.name);
                            q.visible = true; // Force visible
                        }
                    });

                    // Define a function to apply Admin View state
                    survey.applyAdminViewState = () => {
                        allQuestions.forEach(q => {
                            if (originalHiddenQuestions.includes(q.name)) {
                                q.readOnly = false; // Admin fields are editable
                            } else {
                                q.readOnly = true; // Public fields are read-only
                            }
                        });
                    };

                    // Define a function to apply Full Edit state
                    survey.applyFullEditState = () => {
                        allQuestions.forEach(q => {
                            q.readOnly = false; // All fields editable
                            q.visible = true;   // Show all fields including hidden ones
                        });
                    };

                    // Initial State: Full Edit (all fields editable)
                    // Initial State: Admin View (default for existing data)
                    survey.applyAdminViewState();
                    // survey.applyFullEditState(); // Commented out - default to admin view
                    survey.isAdminView = true; // Track state
                    initialMode = 'admin_view'; // We use 'admin_view' mode by default
                }

                // 检查 URL 查询参数
                const queryParams = new URLSearchParams(location.search);

                // Set mode based on whether we have existing data or not
                if (dataId) {
                    setCurrentMode('admin_view');
                } else {
                    setCurrentMode('edit');
                }

                survey.mode = 'edit'; // SurveyJS mode is always 'edit' to allow admin edits

                // 3. 设置 onComplete 回调
                survey.onComplete.add(async (sender) => {
                    const formData = sender.data;
                    setSubmissionState('submitting');

                    try {
                        let response;
                        if (dataId) {
                            // 更新数据
                            response = await api.patch(`/form-data/${dataId}`, { data: formData });
                        } else {
                            // 提交新数据
                            response = await api.post(`/form-data/submit/${formResponse.data.id}`, { data: formData });
                        }

                        // 准备结果数据
                        const backendScore = response.data?.score;
                        const questions = sender.getAllQuestions();
                        const isQuizLocal = questions.some(q => q.correctAnswer !== undefined);
                        const totalQuestions = sender.getQuizQuestionCount();

                        // 即使后端没有返回分数（例如 schema 缺少 correctAnswer），我们也尝试显示一个结果页
                        // 如果是 EXAM 类型，后端应该返回 score (可能是 0)

                        let finalScore = 0;
                        let correctAnswers = 0;

                        if (backendScore !== undefined) {
                            finalScore = backendScore;
                            correctAnswers = Math.round((finalScore / 100) * totalQuestions);
                        } else if (isQuizLocal) {
                            correctAnswers = sender.getCorrectedAnswerCount();
                            finalScore = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
                        }

                        // 只要是 EXAM 类型或者有分数，就显示结果页
                        const isExamType = formResponse.data.form_type === 'EXAM';

                        if (isExamType || backendScore !== undefined || isQuizLocal) {
                            setScoreResult({
                                score: finalScore,
                                correctAnswers: correctAnswers,
                                totalQuestions: totalQuestions,
                                incorrectAnswers: totalQuestions - correctAnswers
                            });
                        } else {
                            if (!dataId) alert('提交成功！');
                            else alert('更新成功！');
                            navigate(-1);
                        }

                        setSubmissionState('completed');

                    } catch (err) {
                        console.error('提交表单失败:', err);
                        alert(`提交失败: ${err.response?.data?.message || err.message}`);
                        setSubmissionState('idle'); // 允许重试
                    }
                });

                // Universal HTML title rendering (for both new and existing forms)
                survey.onAfterRenderQuestion.add((sender, options) => {
                    // 1. Force title rendering for HTML questions if not present
                    if (options.question.getType() === 'html') {
                        // Check if title exists
                        const titleEl = options.htmlElement.querySelector('.sd-question__title') || options.htmlElement.querySelector('.sv-question__title');
                        if (!titleEl && options.question.title) {
                            const customTitle = document.createElement('h5');
                            customTitle.className = 'sd-question__title sd-element__title';
                            customTitle.style.cssText = 'margin: 0 0 10px 0; font-weight: bold; font-size: 16px; color: #404040;';
                            customTitle.innerText = options.question.title;

                            // Insert at the top
                            options.htmlElement.insertBefore(customTitle, options.htmlElement.firstChild);
                        }
                    }

                    // 2. 强制题目标题换行 - 使用 MutationObserver 持续监控
                    const forceWrapTitles = (container) => {
                        if (!container) return;

                        // 查找所有可能的标题元素
                        const selectors = [
                            '.sd-question__title',
                            '.sv-question__title',
                            '.sd-element__title',
                            '.sv-element__title',
                            '.sd-question__header',
                            '.sv-question__header',
                            'h5',
                            '.sd-question__title span', // 针对内部 span
                            '.sv-question__title span'
                        ];

                        selectors.forEach(selector => {
                            const elements = container.querySelectorAll(selector);
                            elements.forEach(el => {
                                el.style.setProperty('white-space', 'normal', 'important');
                                el.style.setProperty('word-wrap', 'break-word', 'important');
                                el.style.setProperty('word-break', 'break-word', 'important');
                                el.style.setProperty('overflow-wrap', 'break-word', 'important');
                                el.style.setProperty('max-width', '100%', 'important');
                                el.style.setProperty('display', 'block', 'important'); // 强制块级显示
                                el.style.setProperty('height', 'auto', 'important');
                            });
                        });
                    };

                    // 立即执行一次
                    forceWrapTitles(options.htmlElement);

                    // 设置 MutationObserver 持续监控
                    const observer = new MutationObserver(() => {
                        forceWrapTitles(options.htmlElement);
                    });

                    observer.observe(options.htmlElement, {
                        attributes: true,
                        attributeFilter: ['style', 'class'],
                        subtree: true
                    });
                });

                // 4. Handle File Uploads to R2
                survey.onUploadFiles.add(async (sender, options) => {
                    const files = options.files;
                    const uploadResults = [];

                    try {
                        for (const file of files) {
                            const formData = new FormData();
                            formData.append('file', file);

                            const response = await api.post('/upload/r2', formData, {
                                headers: {
                                    'Content-Type': 'multipart/form-data'
                                }
                            });

                            uploadResults.push({
                                file: file,
                                content: response.data.url
                            });
                        }

                        options.callback("success", uploadResults);
                    } catch (error) {
                        console.error("Upload failed:", error);
                        options.callback("error", "Upload failed: " + (error.response?.data?.error || error.message));
                    }
                });

                // --- AUTO-FILL LOGIC FOR EXIT SUMMARY FORM (wWVDjd) ---
                if (formToken === 'wWVDjd') {
                    let debounceTimer;
                    survey.onValueChanged.add((sender, options) => {
                        const q = options.question;
                        // Identify the "Name" field (field_1)
                        const isNameField = q.name === 'field_1' || q.name === '姓名' || q.title === '姓名';

                        if (isNameField) {
                            const employeeName = options.value;

                            if (debounceTimer) clearTimeout(debounceTimer);

                            if (!employeeName || typeof employeeName !== 'string' || employeeName.trim().length < 2) {
                                return;
                            }

                            debounceTimer = setTimeout(async () => {
                                try {
                                    console.log(`[AutoFill] Fetching contract for: ${employeeName}`);
                                    const res = await api.get(`/staff/employees/by-name/${encodeURIComponent(employeeName.trim())}/latest-contract`);
                                    const { auto_fill_data, contract } = res.data;

                                    if (auto_fill_data) {
                                        // Helper to find question by possible names/titles
                                        const findQ = (candidates) => {
                                            return survey.getAllQuestions().find(q => candidates.includes(q.name) || candidates.includes(q.title));
                                        };

                                        // Field 2: Customer Name
                                        const qCustomer = findQ(['field_2', '服务的客户姓名']);
                                        if (qCustomer) {
                                            qCustomer.value = auto_fill_data.field_2;
                                        }

                                        // Field 3: Date Range
                                        const qDate = findQ(['field_3', '写清楚上户和下户的时间？（上户年月日～下户年月日）']);
                                        if (qDate) {
                                            qDate.value = auto_fill_data.field_3;
                                        }

                                        // Field 14: Position
                                        const qPosition = findQ(['field_14', '在户上的职位是什么？']);
                                        if (qPosition) {
                                            // Try to match choice text
                                            const textToFind = auto_fill_data.field_14;
                                            const matchedChoice = qPosition.choices.find(c => c.text === textToFind || c.value === textToFind);
                                            if (matchedChoice) {
                                                qPosition.value = matchedChoice.value;
                                            }
                                        }

                                        // Show contract info in Name field description
                                        const contractInfo = `✅ 已自动匹配最新合同:\n类型: ${contract.type_display}${contract.is_monthly_auto_renew ? ' (月签)' : ''}\n客户: ${contract.customer_name}\n日期: ${contract.formatted_date_range}`;
                                        q.description = contractInfo;

                                        // Show success message (optional)
                                        // console.log(`[AutoFill] Successfully filled form for contract: ${contract.id}`);
                                    }
                                } catch (err) {
                                    // console.warn("[AutoFill] Failed to fetch contract:", err);
                                    // Silent fail is better for UX here
                                }
                            }, 500); // 500ms debounce
                        }
                    });
                }

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
    }, [formToken, dataId, location.search]);

    // 切换模式的函数
    const toggleMode = () => {
        if (!surveyModel) return;

        // If we are in "Admin View" (some readOnly, some not), switch to "Full Edit" (all not readOnly).
        // If we are in "Full Edit", switch back to "Admin View".

        // How to detect current state? We can check a flag or just toggle.
        // Let's add a custom property to surveyModel to track state.

        if (surveyModel.isAdminView) {
            surveyModel.applyFullEditState();
            surveyModel.isAdminView = false;
            setCurrentMode('full_edit'); // Custom mode name for UI
        } else {
            surveyModel.applyAdminViewState();
            surveyModel.isAdminView = true;
            setCurrentMode('admin_view'); // Custom mode name for UI
        }
    };

    // Score Display Component
    const ScoreDisplay = ({ result }) => {
        if (!result) return null;

        const { score, correctAnswers, totalQuestions, incorrectAnswers } = result;

        let scoreColor = "#f59e0b"; // 默认橙色
        let message = "继续加油，下次一定能通过！";

        if (score >= 90) {
            scoreColor = "#10b981"; // 绿色
            message = "太棒了！成绩优秀！";
        } else if (score >= 60) {
            scoreColor = "#3b82f6"; // 蓝色
            message = "恭喜通过考试！";
        }

        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                p: 4,
                bgcolor: 'white',
                borderRadius: 2,
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                maxWidth: 500,
                mx: 'auto',
                mt: 4,
                textAlign: 'center'
            }}>
                <Box sx={{ mb: 2 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke={scoreColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </Box>

                <Typography variant="h5" sx={{ fontWeight: 700, color: '#111827', mb: 1 }}>
                    {message}
                </Typography>

                <Box sx={{ my: 3 }}>
                    <Typography variant="h1" sx={{ fontWeight: 800, color: scoreColor, fontSize: '4rem', display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>
                        {score}<Typography component="span" sx={{ fontSize: '1.5rem', color: '#6b7280', ml: 1 }}>分</Typography>
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 3, mb: 4, color: '#6b7280' }}>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        <span style={{ color: '#10b981', marginRight: 4 }}>✓</span>
                        正确: {correctAnswers}
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        <span style={{ color: '#ef4444', marginRight: 4 }}>✗</span>
                        错误: {incorrectAnswers}
                    </Typography>
                </Box>

                <Button
                    variant="contained"
                    onClick={() => window.location.reload()}
                    sx={{
                        bgcolor: scoreColor,
                        '&:hover': { bgcolor: scoreColor },
                        px: 4,
                        py: 1.5,
                        borderRadius: 2,
                        fontSize: '1rem',
                        fontWeight: 600
                    }}
                >
                    再次挑战
                </Button>
            </Box>
        );
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

    // Render Score Result if completed
    if (submissionState === 'completed' && scoreResult) {
        return (
            <Box sx={{ bgcolor: '#f3f4f6', minHeight: '100vh', py: 4 }}>
                <Container maxWidth="md">
                    <ScoreDisplay result={scoreResult} />
                </Container>
            </Box>
        );
    }

    // Render Loading during submission
    if (submissionState === 'submitting') {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', bgcolor: '#f3f4f6' }}>
                <CircularProgress size={60} thickness={4} sx={{ mb: 2 }} />
                <Typography variant="h6" color="text.secondary">正在提交并计算分数...</Typography>
            </Box>
        );
    }

    return (
        <Container maxWidth="md" sx={{ mt: 4, px: { xs: 1, sm: 2, md: 3 } }}>
            {/* 使用 React Portal 将按钮渲染到 SurveyJS 的标题区域 */}
            {dataId && surveyModel && (
                <HeaderButtonsPortal
                    currentMode={currentMode}
                    toggleMode={toggleMode}
                    formToken={formToken}
                    dataId={dataId}
                    api={api}
                />
            )}

            <style>{`
                /* 隐藏表单描述,减少顶部空白 */
                .sd-description,
                .sv-description {
                    display: none !important;
                }
                
                /* ===== 移动端强制优化 (最高优先级) ===== */
                @media (max-width: 768px) {
                    /* 强制减少顶部空白 */
                    body .sd-root-modern .sd-container-modern {
                        margin: 0.25rem auto !important;
                    }
                    
                    /* 强制减少标题区域 padding */
                    body .sd-root-modern .sd-container-modern__title {
                        padding: 1rem 0.75rem !important;
                    }
                    
                    /* 强制减少表单主体 padding */
                    body .sd-root-modern .sd-body {
                        padding: 0.75rem 0.5rem !important;
                    }
                    
                    /* 强制减少页面 padding */
                    body .sd-root-modern .sd-page {
                        padding: 0.25rem !important;
                    }
                    
                    /* 强制题目标题换行 - 核武器级 CSS */
                    body .sd-root-modern .sd-question__title,
                    body .sd-root-modern .sd-question__title *,
                    body .sd-root-modern .sv-question__title,
                    body .sd-root-modern .sv-question__title *,
                    body .sd-root-modern .sd-question__header,
                    body .sd-root-modern .sd-question__header *,
                    body .sd-root-modern h5,
                    body .sd-root-modern h5 * {
                        white-space: normal !important;
                        word-wrap: break-word !important;
                        word-break: break-word !important;
                        overflow-wrap: break-word !important;
                        overflow: visible !important;
                        text-overflow: clip !important;
                        height: auto !important;
                        width: auto !important;
                        max-width: 100% !important;
                        display: block !important;
                    }
                    
                    /* 强制题目容器边距 */
                    body .sd-root-modern .sd-question,
                    body .sd-root-modern .sv-question {
                        padding-left: 10px !important;
                        padding-right: 10px !important;
                        padding-top: 10px !important;
                    }
                    
                    /* 强制选项文字换行 */
                    body .sd-root-modern .sd-item__control-label,
                    body .sd-root-modern .sv-item__control-label,
                    body .sd-root-modern .sd-selectbase__label,
                    body .sd-root-modern .sv-selectbase__label {
                        white-space: normal !important;
                        word-wrap: break-word !important;
                        overflow-wrap: break-word !important;
                    }
                    
                    /* Container 优化 */
                    .MuiContainer-root {
                        padding-left: 8px !important;
                        padding-right: 8px !important;
                    }

                    /* 移动端头部按钮调整 */
                    .custom-header-buttons {
                        top: 1rem !important;
                        right: 0.5rem !important;
                        transform: none !important;
                    }
                }
            `}</style>

            <Survey model={surveyModel} />
        </Container>
    );
};

export default DynamicFormPage;
