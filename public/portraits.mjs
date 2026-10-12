export const PORTRAIT_EMOTIONS = [
 ['happy','开心'],['sad','难过'],['angry','生气'],
 ['shy','害羞'],['surprised','惊讶'],['thinking','思考']
];
// 仅用于选择画面表情，不作为用户真实情绪或好感度的判断。
export function portraitEmotion(text=''){
 const content=String(text).normalize('NFKC');
 const rules=[
  ['sad',/不开心|不高兴|难过|伤心|失落|委屈|想哭|难受|😭|😢|🥺/u],
  ['angry',/生气|愤怒|气死|烦死|太过分|😡|😠|🤬/u],
  ['shy',/害羞|脸红|不好意思|羞涩|🫣|☺️|😳/u],
  ['surprised',/惊讶|震惊|没想到|居然|哇[！!～~]|😲|😮|🤯/u],
  ['happy',/开心|高兴|快乐|哈哈|太棒|好耶|幸福|😊|😄|😁|🥳/u],
  ['thinking',/想想|思考|考虑|好奇|为什么|怎么回事|🤔/u]
 ];
 // 常见否定句不能选出被否定的情绪。
 const cleaned=content.replace(/(?:不|没有|并不|没)(?:生气|难过|伤心|害羞|高兴|开心)/gu,'');
 if(/不开心|不高兴/u.test(content))return 'sad';
 return rules.find(([,pattern])=>pattern.test(cleaned))?.[0]||'default';
}
export function portraitSelection(person,text){
 const emotion=portraitEmotion(text),version=person.avatarEmotions?.[emotion];
 return version?{emotion,version}:{emotion:'default',version:person.avatarVersion||0};
}
