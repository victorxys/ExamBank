import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResponsiveDatePicker } from '../components/ui/ResponsiveDatePicker';
import { ResponsiveTimePicker } from '../components/ui/ResponsiveTimePicker';

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
