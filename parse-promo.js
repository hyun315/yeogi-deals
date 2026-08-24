// Vercel 서버리스 함수 — 클라이언트는 여기로만 요청을 보내고,
// 실제 Anthropic API 키는 서버(Vercel 환경변수)에만 존재합니다.
//
// 배포 후 Vercel 프로젝트 설정 > Environment Variables 에
//   ANTHROPIC_API_KEY = sk-ant-...
// 를 반드시 추가해야 동작합니다.

const SYSTEM = `너는 인도네시아(자카르타·발리)의 골프장·호텔 프로모션 포스터를 한국인 거주자용 카드로 정리한다.

절대 규칙:
1. 포스터에 적혀 있지 않은 정보는 절대 추측하지 않는다. 업계 관행으로 짐작하지 않는다.
2. total_price는 지불해야 할 모든 구성요소가 포스터에 명시돼 있을 때만 계산한다. 하나라도 불명확하면 null로 두고 그 이유를 unclear에 한국어로 적는다.
3. "++" 표기는 세금+서비스 21%를 뜻한다. 금액에 ++가 붙어 있으면 21%를 더해 total_price를 만들고, includes에 "세금·서비스 21%"를 넣는다.
4. 골프는 그린피 외 캐디피·카트·버기·보험·세금이 별도인 경우가 많다. 이 항목들이 포스터에 없으면 total_price를 만들지 말고 unclear에 "캐디·카트 요금 미표기"처럼 적는다.
5. 포스터가 여러 요금제를 나열한 일반 요금표(평일/주말, 회원/비회원 등)라면, 가장 대표적인 한 가지 요금(평일 일반 요금 우선)을 total_price로 쓰고, 나머지 요금은 conditions에 "주말 AM 2,810,000" 처럼 요약해 넣는다.
6. 연도가 없는 날짜는 오늘 날짜를 기준으로 가장 가까운 미래로 해석한다.
7. 모든 한국어 출력은 성인 대상의 담백한 문장으로 쓴다.

JSON만 출력한다. 마크다운 백틱, 설명, 서두 금지.
{
 "category":"golf"|"hotel",
 "venue":"업장명(현지 표기 그대로)",
 "area":"자카르타"|"발리"|"기타",
 "title":"프로모션 한 줄 한국어 요약(35자 이내)",
 "base_price":숫자|null,
 "total_price":숫자|null,
 "price_basis":"1인 18홀"|"1박 2인"등 한국어,
 "includes":["그린피","캐디","카트","세금·서비스 21%"],
 "excludes":["별도 항목"],
 "unclear":["확인이 필요한 항목"],
 "conditions":["평일 한정","2인 이상","조식 2인 포함"],
 "valid_from":"YYYY-MM-DD"|null,
 "valid_to":"YYYY-MM-DD"|null
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다. Vercel 프로젝트 설정에서 환경변수를 추가해 주세요.' });
    return;
  }

  try {
    const { image, today } = req.body || {};
    if (!image) {
      res.status(400).json({ error: '이미지 데이터가 없습니다.' });
      return;
    }
    const base64 = image.includes(',') ? image.split(',')[1] : image;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM + '\n오늘 날짜: ' + (today || new Date().toISOString().slice(0, 10)),
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: '이 포스터를 위 스키마의 JSON으로 정리해라.' }
          ]
        }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(anthropicRes.status).json({ error: 'Anthropic API 오류: ' + errText });
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      res.status(502).json({ error: '포스터에서 요금 정보를 읽지 못했습니다.' });
      return;
    }

    res.status(200).json(JSON.parse(match[0]));
  } catch (err) {
    res.status(500).json({ error: err.message || '알 수 없는 오류가 발생했습니다.' });
  }
}
