// dateUtils.js
import moment from 'moment';
import 'moment/locale/zh-cn'; // 引入中文本地化

export function formatRelativeTime(isoTimeString, thresholdDays = 7) {
    try {
        // 直接使用moment解析ISO格式的时间字符串
        const time = moment(isoTimeString);
        moment.locale('zh-cn'); // 明确设置 moment.js 的全局 locale 为中文 (zh-cn)

        if (!time.isValid()) {
            console.error('Invalid time format:', isoTimeString);
            return "无效的时间格式";
        }

        const now = moment(); // 获取当前时间
        const diffDays = now.diff(time, 'days');

        if (diffDays < thresholdDays) {
            return time.fromNow(); // 使用 fromNow() 获取相对时间，此时应该会是中文
        } else {
            return time.format('YYYY-MM-DD HH:mm'); // 格式化为 YYYY-MM-DD HH:mm，保持日期和时间格式
        }
    } catch (error) {
        console.error('Error formatting time:', error);
        return "无效的时间格式";
    }
}