export const PORTRAIT_EMOTIONS = [
 ['happy','开心'],['sad','难过'],['angry','生气'],
 ['shy','害羞'],['surprised','惊讶'],['thinking','思考']
];
// 仅用于选择画面表情，不作为用户真实情绪或好感度的判断。
export function portraitEmotion(analysis){
 return PORTRAIT_EMOTIONS.some(([id])=>id===analysis?.label)&&Number.isInteger(analysis?.confidence)&&analysis.confidence>=70&&analysis.confidence<=100?analysis.label:'default';
}
export function portraitSelection(person,analysis){
 const emotion=portraitEmotion(analysis),version=person.portraitEmotions?.[emotion];
 return version?{emotion,version}:{emotion:'default',version:person.portraitVersion||0};
}
