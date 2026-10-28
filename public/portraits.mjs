/**
 * 聊天立绘的可用表情列表及资源选择规则。
 * 只有已知且达到置信度阈值的情绪才参与选择，资源不足时使用默认立绘。
 */

export const PORTRAIT_EMOTIONS = [
  ['happy', '开心'],
  ['sad', '难过'],
  ['angry', '生气'],
  ['shy', '害羞'],
  ['surprised', '惊讶'],
  ['thinking', '思考']
];
// 仅用于选择画面表情，不作为用户真实情绪或好感度的判断。

/**
 * 从情绪分析中选出达到阈值的已知立绘表情。
 * 未知标签、非整数或低置信度统一返回 default，不猜测替代表情。
 */
export function portraitEmotion(analysis) {
  return PORTRAIT_EMOTIONS.some(([id]) => id === analysis?.label) &&
    Number.isInteger(analysis?.confidence) &&
    analysis.confidence >= 70 &&
    analysis.confidence <= 100
    ? analysis.label
    : 'default';
}

/**
 * 结合情绪判断与人物已上传的资源版本选择图片。
 * 对应情绪没有资源时回退默认版本，返回值供页面生成带版本号的地址。
 */
export function portraitSelection(person, analysis) {
  // 优先采用已上传的对应表情；缺少资源时回退到默认立绘版本。
  const emotion = portraitEmotion(analysis),
    version = person.portraitEmotions?.[emotion];
  return version
    ? { emotion, version }
    : { emotion: 'default', version: person.portraitVersion || 0 };
}
