/** Korean particles depend on whether the label ends in a final consonant: 구입가는 / 결제액은. */
export function particles(label: string) {
  const last = label.charCodeAt(label.length - 1) - 0xac00;
  const final = last >= 0 && last < 11172 && last % 28 !== 0;
  return final ? { topic: '은', object: '을' } : { topic: '는', object: '를' };
}
