import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResponsiveDatePicker } from '../components/ui/ResponsiveDatePicker';
import { ResponsiveTimePicker } from '../components/ui/ResponsiveTimePicker';
import { FullscreenSignaturePad } from '../components/ui/FullscreenSignaturePad';

/**
 * 为 SurveyJS 日期/时间字段创建自定义渲染
 * 
 * 使用方法:
 * survey.onAfterRenderQuestion.add(createDateTimeRenderer());
 */
export function createDateTimeRenderer() {
    // 存储 React roots 以便清理
    const reactRoots = new Map();

    return (sender, options) => {
        const question = options.question;
        const questionType = question.getType();

        // 只处理 text 类型的问题
        if (questionType !== 'text') return;

        // 检查 inputType 来确定是否是日期/时间字段
        const inputType = question.inputType;
        if (!['date', 'datetime', 'datetime-local', 'time'].includes(inputType)) return;

        // 如果是只读模式，不替换原生控件
        if (sender.mode === 'display') return;

        // 找到输入容器
        const contentDiv = options.htmlElement.querySelector('.sd-question__content') || options.htmlElement;
        const originalInput = contentDiv.querySelector('input');

        if (!originalInput) return;

        // 防止重复渲染
        if (contentDiv.querySelector('.responsive-picker-container')) return;

        // 隐藏原始输入
        const inputContainer = originalInput.closest('.sd-input') || originalInput.parentElement;
        if (inputContainer) {
            inputContainer.style.display = 'none';
        }

        // 创建自定义选择器容器
        const pickerContainer = document.createElement('div');
        pickerContainer.className = 'responsive-picker-container';
        contentDiv.appendChild(pickerContainer);

        // 创建 React root
        const root = createRoot(pickerContainer);
        const questionName = question.name;
        reactRoots.set(questionName, root);

        // 检查是否在表格(matrix)中
        const isInMatrix = question.parent && (
            question.parent.getType() === 'matrixdynamic' ||
            question.parent.getType() === 'matrixdropdown' ||
            question.parent.getType() === 'matrix'
        );

        // 表格中日期控件高度与输入框一致 (2.5rem = 40px)
        const heightClass = isInMatrix ? "h-10 min-h-0 px-2 py-[0.375rem] text-[0.8125rem]" : "";

        // 根据类型渲染对应的选择器
        if (inputType === 'date' || inputType === 'datetime' || inputType === 'datetime-local') {
            // 日期选择器
            const DatePickerWrapper = () => {
                const [value, setValue] = React.useState(() => {
                    const v = question.value;
                    return v ? new Date(v) : undefined;
                });

                React.useEffect(() => {
                    // 监听 SurveyJS 值变化
                    const updateValue = () => {
                        const v = question.value;
                        setValue(v ? new Date(v) : undefined);
                    };
                    question.registerFunctionOnPropertyValueChanged('value', updateValue);
                    return () => {
                        question.unRegisterFunctionOnPropertyValueChanged('value', updateValue);
                    };
                }, []);

                const handleChange = (date) => {
                    setValue(date);
                    if (date) {
                        // 格式化为 ISO 日期字符串
                        const isoString = date.toISOString().split('T')[0];
                        question.value = isoString;
                    } else {
                        question.value = undefined;
                    }
                };

                return (
                    <ResponsiveDatePicker
                        value={value}
                        onChange={handleChange}
                        placeholder={question.placeholder || '选择日期'}
                        disabled={question.isReadOnly}
                        className={heightClass}
                    />
                );
            };

            root.render(<DatePickerWrapper />);

        } else if (inputType === 'time') {
            // 时间选择器
            const TimePickerWrapper = () => {
                const [value, setValue] = React.useState(() => question.value || '');

                React.useEffect(() => {
                    const updateValue = () => {
                        setValue(question.value || '');
                    };
                    question.registerFunctionOnPropertyValueChanged('value', updateValue);
                    return () => {
                        question.unRegisterFunctionOnPropertyValueChanged('value', updateValue);
                    };
                }, []);

                const handleChange = (time) => {
                    setValue(time);
                    question.value = time;
                };

                return (
                    <ResponsiveTimePicker
                        value={value}
                        onChange={handleChange}
                        placeholder={question.placeholder || '选择时间'}
                        disabled={question.isReadOnly}
                        minuteStep={30}
                        className={heightClass}
                    />
                );
            };

            root.render(<TimePickerWrapper />);
        }
    };
}

/**
 * 清理所有创建的 React roots
 * 在组件卸载时调用
 */
export function cleanupDateTimeRenderers(reactRoots) {
    reactRoots.forEach((root) => {
        root.unmount();
    });
    reactRoots.clear();
}

/**
 * 修复 SurveyJS signaturepad 的触摸偏移问题
 * 
 * 问题原因：canvas 的 CSS 尺寸（通过 width: 100% 设置）与 canvas 的
 * 内部像素尺寸（width/height 属性）不一致，导致坐标计算错误。
 * 
 * 解决方案：完全替换原生 signaturepad，使用自定义的全屏横屏签名组件。
 * 点击签名区域后会进入全屏横屏模式，最大化签名区域，解决偏移问题。
 * 
 * 使用方法:
 * survey.onAfterRenderQuestion.add(createSignaturePadFixer());
 */
export function createSignaturePadFixer() {
    const reactRoots = new Map();

    return (sender, options) => {
        const question = options.question;
        
        // 只处理 signaturepad 类型
        if (question.getType() !== 'signaturepad') return;
        
        const container = options.htmlElement;
        const contentDiv = container.querySelector('.sd-question__content') || container;
        
        // 防止重复渲染
        if (contentDiv.querySelector('.fullscreen-signature-container')) return;
        
        // 隐藏原生 signaturepad（无论是编辑还是只读模式都隐藏）
        const originalSignaturepad = contentDiv.querySelector('.sd-signaturepad');
        if (originalSignaturepad) {
            originalSignaturepad.style.display = 'none';
        }
        
        // 如果是只读模式，只显示签名图片
        if (sender.mode === 'display') {
            const signatureValue = question.value;
            if (signatureValue) {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'fullscreen-signature-container';
                imgContainer.style.cssText = 'width: 100%; min-height: 120px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; display: flex; align-items: center; justify-content: center; padding: 8px;';
                
                const img = document.createElement('img');
                img.src = signatureValue;
                img.alt = '签名';
                img.style.cssText = 'max-width: 100%; max-height: 150px; object-fit: contain;';
                
                imgContainer.appendChild(img);
                contentDiv.appendChild(imgContainer);
            }
            return;
        }
        
        // 创建自定义签名组件容器
        const signatureContainer = document.createElement('div');
        signatureContainer.className = 'fullscreen-signature-container';
        contentDiv.appendChild(signatureContainer);
        
        // 创建 React root
        const root = createRoot(signatureContainer);
        const questionName = question.name;
        reactRoots.set(questionName, root);
        
        // 签名组件包装器
        const SignatureWrapper = () => {
            const [value, setValue] = React.useState(() => question.value || null);
            
            React.useEffect(() => {
                // 监听 SurveyJS 值变化
                const updateValue = () => {
                    setValue(question.value || null);
                };
                question.registerFunctionOnPropertyValueChanged('value', updateValue);
                return () => {
                    question.unRegisterFunctionOnPropertyValueChanged('value', updateValue);
                };
            }, []);
            
            const handleChange = (dataUrl) => {
                setValue(dataUrl);
                question.value = dataUrl;
            };
            
            return (
                <FullscreenSignaturePad
                    value={value}
                    onChange={handleChange}
                    disabled={question.isReadOnly}
                    placeholder={question.placeholder || '点击此处签名'}
                />
            );
        };
        
        root.render(<SignatureWrapper />);
    };
}
