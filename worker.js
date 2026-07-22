// Cloudflare Worker — 转发 Sina 基金估值 API，绕过 Referer 限制
// 部署到 workers.dev 免费域名

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    if (!code) return new Response('Missing ?code=', { status: 400 });

    const sinaUrl = `https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic?symbol=${code}`;
    
    const resp = await fetch(sinaUrl, {
      headers: { 'Referer': 'https://finance.sina.com.cn/' }
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
};
