import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// import { createPortal } from 'react-dom'; // Removed to avoid production build issues
import { useParams, useLocation, useNavigate } from 'react-router-dom'; // 导入 useLocation 和 useNavigate
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import '../styles/survey-theme-shadcn.css'; // Import Shadcn-style Theme
// Import Chinese language pack
import 'survey-core/i18n/simplified-chinese';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';

// Note: Language will be set on each survey instance
import api from '../api/axios';
import {
    Container,
    CircularProgress,
    Alert,
    Box,
    Button,
    Typography,
    IconButton,
    Portal, // Import Portal from MUI
    Modal,
    Skeleton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { 
    ImageNotSupported as ImageNotSupportedIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import { formatAddress } from '../utils/formatUtils';
import { createDateTimeRenderer } from '../utils/surveyjs-custom-widgets.jsx';
import AlertMessage from './AlertMessage';

// Optimized Image Components with Lightbox
const OptimizedFileCarousel = ({ questionValue, onImageClick }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [imageErrors, setImageErrors] = useState({});

    const updateDisplay = (index) => {
        setCurrentIndex(index);
    };

    if (!Array.isArray(questionValue) || questionValue.length === 0) {
        return null;
    }

    const file = questionValue[currentIndex];

    return (
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 1 }}>
            {/* Image Display */}
            <Box
                sx={{
                    position: 'relative',
                    maxWidth: '100%',
                    maxHeight: '800px',
                    cursor: 'pointer',
                }}
                onClick={() => onImageClick && onImageClick(currentIndex)}
            >
                {imageErrors[currentIndex] ? (
                    <Box
                        sx={{
                            width: '400px',
                            height: '300px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '4px',
                            border: '1px solid #dee2e6',
                        }}
                    >
                        <ImageNotSupportedIcon sx={{ fontSize: 60, color: '#6c757d' }} />
                    </Box>
                ) : (
                    <LazyLoadImage
                        src={file?.content}
                        alt={`Image ${currentIndex + 1}`}
                        effect="blur"
                        placeholderSrc="/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0xNTAgMTUwIEgyNTAgTDIwMCAxMjVWMjI1WiIgc3Ryb2tlPSIjRERFRTJGIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8Y2lyY2xlIGN4PSIyMjUiIGN5PSIxMjUiIHI9IjYiIGZpbGw9IiNEREVFMkYiLz4KPC9zdmc+Cg=="
                        onError={() => setImageErrors(prev => ({ ...prev, [currentIndex]: true }))}
                        style={{
                            maxWidth: '100%',
                            maxHeight: '800px',
                            objectFit: 'contain',
                            display: 'block',
                        }}
                    />
                )}
            </Box>

            {/* Controls */}
            {questionValue.length > 1 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <IconButton
                        onClick={(e) => {
                            e.stopPropagation();
                            if (currentIndex > 0) updateDisplay(currentIndex - 1);
                        }}
                        disabled={currentIndex === 0}
                        size="small"
                    >
                        <ChevronLeftIcon />
                    </IconButton>
                    <Typography variant="body2" color="text.secondary">
                        {currentIndex + 1} / {questionValue.length}
                    </Typography>
                    <IconButton
                        onClick={(e) => {
                            e.stopPropagation();
                            if (currentIndex < questionValue.length - 1) updateDisplay(currentIndex + 1);
                        }}
                        disabled={currentIndex === questionValue.length - 1}
                        size="small"
                    >
                        <ChevronRightIcon />
                    </IconButton>
                </Box>
            )}
        </Box>
    );
};

const OptimizedSignatureImage = ({ src, style }) => {
    const [imageError, setImageError] = useState(false);

    if (imageError) {
        return (
            <Box
                sx={{
                    ...style,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                }}
            >
                <ImageNotSupportedIcon sx={{ fontSize: 40, color: '#6c757d' }} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    签名加载失败
                </Typography>
            </Box>
        );
    }

    return (
        <LazyLoadImage
            src={src}
            alt="签名图片"
            effect="blur"
            placeholderSrc="/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDIwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik03NSA1MCBIMTI1IEwxMDAgNDJWNzVaIiBzdHJva2U9IiNEREVFMkYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxjaXJjbGUgY3g9IjExMiIgY3k9IjQyIiByPSIzIiBmaWxsPSIjRERFRTJGIi8+Cjwvc3ZnPgo="
            onError={() => setImageError(true)}
            style={style}
        />
    );
};

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

    // return (
    //     <Portal container={container}>
    //         {formToken === 'N0Il9H' && (
    //             <Button
    //                 variant="contained"
    //                 color="secondary"
    //                 size="small"
    //                 onClick={async () => {
    //                     if (!window.confirm('确定要根据当前表单数据创建/更新员工信息吗？')) return;
    //                     try {
    //                         const res = await api.post(`/staff/create-from-form/${dataId}`);
    //                         alert(res.data.message);
    //                     } catch (err) {
    //                         console.error(err);
    //                         alert('操作失败: ' + (err.response?.data?.message || err.message));
    //                     }
    //                 }}
    //                 sx={{
    //                     backgroundColor: 'white',
    //                     color: 'secondary.main',
    //                     '&:hover': { backgroundColor: '#f3f4f6' }
    //                 }}
    //             >
    //                 创建员工信息
    //             </Button>
    //         )}
    //         <Button
    //             variant="outlined"
    //             size="small"
    //             onClick={toggleMode}
    //             sx={{
    //                 color: 'white',
    //                 borderColor: 'white',
    //                 '&:hover': {
    //                     borderColor: 'white',
    //                     backgroundColor: 'rgba(255,255,255,0.1)'
    //                 }
    //             }}
    //         >
    //             切换到 {currentMode === 'admin_view' ? '编辑模式' : '查看模式'}
    //         </Button>
    //     </Portal>
    // );
};

const DynamicFormPage = () => {
    const { formToken, dataId } = useParams();
    const location = useLocation(); // 获取 location 对象
    const navigate = useNavigate(); // 获取 navigate 函数
    const [surveyModel, setSurveyModel] = useState(null);
    const [submissionState, setSubmissionState] = useState('idle'); // 'idle', 'submitting', 'completed'
    const [scoreResult, setScoreResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentMode, setCurrentMode] = useState('admin_view'); // 默认为编辑模式
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    
    // Lightbox state for image viewing
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxImages, setLightboxImages] = useState([]);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

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

                // 管理员编辑模式下不显示完成页面
                if (dataId) {
                    survey.showCompletedPage = false;
                }

                // Force storeDataAsText to false for all file questions to ensure we store the URL, not Base64
                survey.getAllQuestions().forEach(question => {
                    if (question.getType() === 'file') {
                        question.storeDataAsText = false;
                    }
                });

                // 注册自定义日期/时间选择器渲染器
                // 将 SurveyJS 的日期/时间字段替换为响应式选择器组件
                survey.onAfterRenderQuestion.add(createDateTimeRenderer());

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
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                            `;
                            icon.title = '此字段仅管理员可见';
                            icon.style.cssText = 'display: inline-flex;';
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

                            // Relocate the "Add Row" button outside the scrollable table container
                            const relocateAddRowButton = () => {
                                const footer = options.htmlElement.querySelector('.sd-matrixdynamic__footer');
                                if (!footer || footer.dataset.customizedFooter === 'true') {
                                    return;
                                }

                                footer.dataset.customizedFooter = 'true';

                                const questionRoot = options.htmlElement;
                                const content = questionRoot.querySelector('.sd-question__content');
                                const table = content?.querySelector('.sd-table');
                                
                                // Wrap table in a scroll container if not already wrapped
                                if (table && !table.parentElement.classList.contains('matrix-scroll-container')) {
                                    const scrollContainer = document.createElement('div');
                                    scrollContainer.className = 'matrix-scroll-container';
                                    table.parentNode.insertBefore(scrollContainer, table);
                                    scrollContainer.appendChild(table);
                                }

                                let wrapper = questionRoot.querySelector('.matrix-add-row-wrapper');

                                if (!wrapper) {
                                    wrapper = document.createElement('div');
                                    wrapper.className = 'matrix-add-row-wrapper';

                                    if (content && content.parentNode) {
                                        content.insertAdjacentElement('afterend', wrapper);
                                    } else {
                                        questionRoot.appendChild(wrapper);
                                    }
                                }

                                wrapper.appendChild(footer);
                            };

                            relocateAddRowButton();

                            const footerObserver = new MutationObserver(relocateAddRowButton);
                            footerObserver.observe(options.htmlElement, {
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
                                if (contentDiv.querySelector('.custom-file-carousel-root')) {
                                    return;
                                }

                                if (Array.isArray(questionValue) && questionValue.length > 0) {
                                    // Hide default preview
                                    const defaultPreview = contentDiv.querySelector('.sd-file');
                                    if (defaultPreview) {
                                        defaultPreview.style.display = 'none';
                                    }

                                    // Create container for React component
                                    const carouselContainer = document.createElement('div');
                                    carouselContainer.className = 'custom-file-carousel-root';
                                    carouselContainer.style.width = '100%';
                                    contentDiv.appendChild(carouselContainer);
                                    
                                    // Render React component using createRoot
                                    const root = createRoot(carouselContainer);
                                    
                                    // Extract image URLs from questionValue
                                    const imageUrls = questionValue.map(file => file.content).filter(Boolean);
                                    
                                    root.render(
                                        <OptimizedFileCarousel 
                                            questionValue={questionValue}
                                            onImageClick={(index) => {
                                                setLightboxImages(imageUrls);
                                                setCurrentImageIndex(index);
                                                setLightboxOpen(true);
                                            }}
                                        />
                                    );
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
                                    // Optimized signature image with React component
                                    const signatureContainer = document.createElement('div');
                                    wrapper.appendChild(signatureContainer);
                                    const root = createRoot(signatureContainer);
                                    root.render(
                                        <OptimizedSignatureImage 
                                            src={questionValue} 
                                            style={{ display: 'block', maxWidth: '200px', maxHeight: '100px' }} 
                                        />
                                    );
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
                            // 考试类型：显示分数结果页面
                            setScoreResult({
                                score: finalScore,
                                correctAnswers: correctAnswers,
                                totalQuestions: totalQuestions,
                                incorrectAnswers: totalQuestions - correctAnswers
                            });
                            setSubmissionState('completed');
                        } else {
                            // 非考试类型：区分管理员编辑和访客提交
                            if (dataId) {
                                // 管理员编辑：显示提示并刷新页面，不设置 completed 状态
                                setAlert({
                                    open: true,
                                    message: '保存成功！',
                                    severity: 'success'
                                });
                                setTimeout(() => window.location.reload(), 100);
                            } else {
                                // 访客提交：设置 completed 状态，SurveyJS 会自动显示 completedHtml
                                setSubmissionState('completed');
                            }
                        }

                    } catch (err) {
                        console.error('提交表单失败:', err);
                        setAlert({
                            open: true,
                            message: `提交失败: ${err.response?.data?.message || err.message}`,
                            severity: 'error'
                        });
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
                                // 跳过必填标记元素
                                if (el.classList.contains('sd-question__required-text') ||
                                    el.getAttribute('data-key') === 'req-text' ||
                                    el.getAttribute('data-key') === 'req-sp') {
                                    // 为必填标记设置 inline 显示
                                    el.style.setProperty('display', 'inline', 'important');
                                    el.style.setProperty('width', 'auto', 'important');
                                    return;
                                }

                                el.style.setProperty('white-space', 'normal', 'important');
                                el.style.setProperty('word-wrap', 'break-word', 'important');
                                el.style.setProperty('word-break', 'break-word', 'important');
                                el.style.setProperty('overflow-wrap', 'break-word', 'important');

                                // 标题容器使用 flex 布局
                                if (el.classList.contains('sd-question__title') ||
                                    el.classList.contains('sv-question__title') ||
                                    el.classList.contains('sd-element__title') ||
                                    el.classList.contains('sv-element__title')) {
                                    el.style.setProperty('max-width', '100%', 'important');
                                    el.style.setProperty('display', 'flex', 'important');
                                    el.style.setProperty('flex-wrap', 'wrap', 'important');
                                    el.style.setProperty('align-items', 'baseline', 'important');
                                }
                                // 标题内的文本 span 使用 inline 显示，不限制宽度
                                else if (el.classList.contains('sv-string-viewer') ||
                                    el.parentElement?.classList.contains('sd-question__title') ||
                                    el.parentElement?.classList.contains('sv-question__title')) {
                                    el.style.setProperty('display', 'inline', 'important');
                                    // 不设置 max-width，让文本和必填标记在同一行
                                }
                                // 其他元素使用 block
                                else {
                                    el.style.setProperty('max-width', '100%', 'important');
                                    el.style.setProperty('display', 'block', 'important');
                                }

                                el.style.setProperty('height', 'auto', 'important');
                            });
                        });
                    };

                    // 3. 规范必填标记，始终与题目文本同一行
                    const mergeTitleSpans = (container) => {
                        if (!container) return;

                        const titleSelectors = [
                            '.sd-question__title',
                            '.sv-question__title',
                            '.sd-element__title',
                            '.sv-element__title'
                        ];

                        titleSelectors.forEach(selector => {
                            const titles = container.querySelectorAll(selector);
                            titles.forEach(titleEl => {
                                if (titleEl.dataset.requiredNormalized === 'true') {
                                    return;
                                }

                                const requiredEls = Array.from(titleEl.querySelectorAll('.sd-question__required-text, [data-key="req-text"]'));
                                const spacerEls = Array.from(titleEl.querySelectorAll('[data-key="req-sp"]'));
                                spacerEls.forEach(el => el.remove());

                                if (requiredEls.length > 0) {
                                    const primaryReq = requiredEls.shift();
                                    requiredEls.forEach(el => el.remove());

                                    const textContainer = titleEl.querySelector('.sv-string-viewer, .sd-string-viewer, span[data-key="question-title"], span[data-name="title"]')
                                        || titleEl.querySelector('span:not(.private-field-icon):not(.sd-question__required-text)')
                                        || titleEl;

                                    // Ensure container can wrap text and star together
                                    textContainer.style.setProperty('display', 'inline', 'important');
                                    textContainer.style.setProperty('white-space', 'normal', 'important');
                                    textContainer.style.setProperty('word-break', 'break-word', 'important');

                                    primaryReq.textContent = '*';
                                    primaryReq.classList.add('sd-question__required-text');
                                    primaryReq.style.setProperty('color', 'hsl(0 84.2% 60.2%)', 'important');
                                    primaryReq.style.setProperty('display', 'inline', 'important');
                                    primaryReq.style.setProperty('width', 'auto', 'important');
                                    primaryReq.style.setProperty('margin-left', '0.25rem', 'important');

                                    primaryReq.remove();
                                    textContainer.appendChild(primaryReq);
                                }

                                titleEl.dataset.requiredNormalized = 'true';
                            });
                        });
                    };

                    // 立即执行一次
                    forceWrapTitles(options.htmlElement);
                    mergeTitleSpans(options.htmlElement);

                    // 设置 MutationObserver 持续监控
                    const observer = new MutationObserver(() => {
                        forceWrapTitles(options.htmlElement);
                        mergeTitleSpans(options.htmlElement);
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

    // Render Loading during submission (only for visitor submissions, not admin edits)
    if (submissionState === 'submitting' && !dataId) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', bgcolor: '#f3f4f6' }}>
                <CircularProgress size={60} thickness={4} sx={{ mb: 2 }} />
                <Typography variant="h6" color="text.secondary">正在提交并计算分数...</Typography>
            </Box>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
            <AlertMessage
                open={alert.open}
                message={alert.message}
                severity={alert.severity}
                onClose={() => setAlert({ ...alert, open: false })}
            />
            {loading && <CircularProgress />}
            {error && <Alert severity="error">{error}</Alert>}
            {!loading && !error && surveyModel && (
                <>
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

                    {submissionState === 'completed' && scoreResult ? (
                        <ScoreDisplay result={scoreResult} />
                    ) : (
                        <Survey model={surveyModel} />
                    )}
                </>
            )}

            <style>{`
                /* 隐藏表单描述,减少顶部空白 */
                .sd-description,
                .sv-description {
                    display: none !important;
                }

                /* 为固定底部操作栏预留空间 */
                body .sd-root-modern {
                    padding-bottom: 80px !important;
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
                    
                    /* 必填标记例外：保持 inline 显示 */
                    body .sd-root-modern .sd-question__required-text,
                    body .sd-root-modern span[data-key="req-text"],
                    body .sd-root-modern span[data-key="req-sp"] {
                        display: inline !important;
                        width: auto !important;
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

            {/* 固定底部操作栏 */}
            {dataId && surveyModel && submissionState !== 'completed' && (
                <Box
                    sx={{
                        position: 'fixed',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: 'white',
                        borderTop: '2px solid #e5e7eb',
                        boxShadow: '0 -4px 6px -1px rgba(0, 0, 0, 0.1), 0 -2px 4px -1px rgba(0, 0, 0, 0.06)',
                        zIndex: 1000,
                        padding: '12px 16px',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        gap: 2
                    }}
                >
                    {/* 创建员工信息按钮（仅 N0Il9H 表单显示） */}
                    {formToken === 'N0Il9H' && (
                        <Button
                            variant="contained"
                            color="secondary"
                            size="medium"
                            onClick={async () => {
                                if (!window.confirm('确定要根据当前表单数据创建/更新员工信息吗？')) return;
                                try {
                                    const res = await api.post(`/staff/create-from-form/${dataId}`);
                                    setAlert({
                                        open: true,
                                        message: res.data.message,
                                        severity: 'success'
                                    });
                                } catch (err) {
                                    console.error(err);
                                    setAlert({
                                        open: true,
                                        message: '操作失败: ' + (err.response?.data?.message || err.message),
                                        severity: 'error'
                                    });
                                }
                            }}
                            sx={{
                                backgroundColor: 'secondary.main',
                                color: 'white',
                                '&:hover': {
                                    backgroundColor: 'secondary.dark'
                                }
                            }}
                        >
                            创建员工信息
                        </Button>
                    )}

                    {/* 模式切换按钮 */}
                    <Button
                        variant="contained"
                        size="medium"
                        onClick={toggleMode}
                        sx={{
                            backgroundColor: 'primary.main',
                            color: 'white',
                            px: 4,
                            '&:hover': {
                                backgroundColor: 'primary.dark'
                            },
                            '&:disabled': {
                                backgroundColor: '#9ca3af'
                            }
                        }}
                    >
                        切换到 {currentMode === 'admin_view' ? '编辑模式' : '查看模式'}
                    </Button>

                    {/* 提交按钮 */}
                    <Button
                        variant="contained"
                        size="medium"
                        onClick={() => {
                            // 触发 SurveyJS 的提交
                            if (surveyModel) {
                                surveyModel.completeLastPage();
                            }
                        }}
                        disabled={submissionState === 'submitting'}
                        sx={{
                            backgroundColor: 'primary.main',
                            color: 'white',
                            px: 4,
                            '&:hover': {
                                backgroundColor: 'primary.dark'
                            },
                            '&:disabled': {
                                backgroundColor: '#9ca3af'
                            }
                        }}
                    >
                        {submissionState === 'submitting' ? '提交中...' : '保存提交'}
                    </Button>
                </Box>
            )}

            {/* Lightbox Modal for Image Viewing */}
            <Modal
                open={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                        setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : lightboxImages.length - 1));
                    } else if (e.key === 'ArrowRight') {
                        setCurrentImageIndex((prev) => (prev < lightboxImages.length - 1 ? prev + 1 : 0));
                    } else if (e.key === 'Escape') {
                        setLightboxOpen(false);
                    }
                }}
            >
                <Box
                    sx={{
                        position: 'relative',
                        outline: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Close Button */}
                    <IconButton
                        onClick={() => setLightboxOpen(false)}
                        sx={{
                            position: 'absolute',
                            top: -50,
                            right: 0,
                            color: 'white',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                            '&:hover': {
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            },
                        }}
                    >
                        <CloseIcon />
                    </IconButton>

                    {/* Previous Button */}
                    {lightboxImages.length > 1 && (
                        <IconButton
                            onClick={() => setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : lightboxImages.length - 1))}
                            sx={{
                                position: 'absolute',
                                left: -60,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                },
                            }}
                        >
                            <ChevronLeftIcon fontSize="large" />
                        </IconButton>
                    )}

                    {/* Image */}
                    <LazyLoadImage
                        src={lightboxImages[currentImageIndex]}
                        alt={`Image ${currentImageIndex + 1}`}
                        placeholderSrc="/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgdmlld0JveD0iMCAwIDgwMCA2MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0zMDAgMzAwIEg1MDAgTDQwMCAyNTBWNTAwWiIgc3Ryb2tlPSIjRERFRTJGIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8Y2lyY2xlIGN4PSI0NTAiIGN5PSIyNTAiIHI9IjgiIGZpbGw9IiNEREVFMkYiLz4KPC9zdmc+Cg=="
                        effect="blur"
                        style={{
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            width: 'auto',
                            height: 'auto',
                            display: 'block',
                            borderRadius: '8px',
                            backgroundColor: 'white',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                            objectFit: 'contain',
                        }}
                        onError={(e) => {
                            e.target.src = "/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0xNTAgMTUwIEgyNTBMMjAwIDEyMlYyNTBaIiBzdHJva2U9IiNEREVFMkYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxjaXJjbGUgY3g9IjIyNSIgY3k9IjEyNSIgcj0iNSIgZmlsbD0iI0RERUUyRiIvPgo8L3N2Zz4K";
                            e.target.style.width = '200px';
                            e.target.style.height = '150px';
                        }}
                    />

                    {/* Next Button */}
                    {lightboxImages.length > 1 && (
                        <IconButton
                            onClick={() => setCurrentImageIndex((prev) => (prev < lightboxImages.length - 1 ? prev + 1 : 0))}
                            sx={{
                                position: 'absolute',
                                right: -60,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                },
                            }}
                        >
                            <ChevronRightIcon fontSize="large" />
                        </IconButton>
                    )}

                    {/* Image Counter */}
                    {lightboxImages.length > 1 && (
                        <Box
                            sx={{
                                position: 'absolute',
                                bottom: -40,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                padding: '8px 16px',
                                borderRadius: '20px',
                                fontSize: '0.875rem',
                            }}
                        >
                            {currentImageIndex + 1} / {lightboxImages.length}
                        </Box>
                    )}
                </Box>
            </Modal>
        </Container>
    );
};

export default DynamicFormPage;
