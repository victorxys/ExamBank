// dateUtils.js
import moment from 'moment';
import 'moment/locale/zh-cn'; // 引入中文本地化

export function formatRelativeTime(gmtTimeString, thresholdDays = 7) {
    try {
        const gmtTime = moment.utc(gmtTimeString, "ddd, DD MMM YYYY HH:mm:ss [GMT]"); // 使用 utc() 并确保年份格式正确
        moment.locale('zh-cn'); // 明确设置 moment.js 的全局 locale 为中文 (zh-cn)

        if (!gmtTime.isValid()) {
            return "无效的时间格式";
        }

        const now = moment.utc(); // 使用 utc() 获取当前时间
        const diffDays = now.diff(gmtTime, 'days');

        if (diffDays < thresholdDays) {
            return gmtTime.fromNow(); // 使用 fromNow() 获取相对时间，此时应该会是中文
        } else {
            return gmtTime.format('YYYY-MM-DD'); // 格式化为 YYYY-MM-DD，保持日期格式
        }
    } catch (error) {
        return "无效的时间格式";
    }
}