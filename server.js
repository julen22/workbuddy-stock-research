#!/usr/bin/env node
/**
 * 股票复盘笔记 - 本地代理服务器
 *
 * 解决两个问题：
 * 1. 浏览器直接 fetch WorkBuddy API 会被 CORS 拦截 → 本地代理转发
 * 2. 同时提供 index.html 静态文件
 *
 * 用法:
 *   node server.js
 *   然后浏览器打开 http://localhost:18927
 *
 * 工作原理:
 *   - GET  /               → 返回 index.html
 *   - POST /api/chat       → 转发到 https://copilot.tencent.com/v2/chat/completions（流式SSE透传）
 *   - GET  /<其他文件>      → 返回对应静态文件
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 18927;
const WB_API_URL = 'https://copilot.tencent.com/v2/chat/completions';
// ⚠️ 请在此处填入你自己的 WorkBuddy / OpenAI 兼容 API Key
// 获取方式：登录 https://codebuddy.cn 后在「设置 → API Keys」生成
// 或在环境变量中设置 WB_API_KEY
const WB_API_KEY = process.env.WB_API_KEY || 'YOUR_API_KEY_HERE';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

function sendFile(res, filePath){
  fs.readFile(filePath, (err, data) => {
    if(err){
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('404 Not Found: ' + path.basename(filePath));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(data);
  });
}

function proxyChat(req, res){
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    // 转发到 WorkBuddy API
    const urlObj = new URL(WB_API_URL);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + WB_API_KEY,
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const proxyReq = https.request(options, (proxyRes) => {
      // 透传响应头（关键：加上 CORS 头）
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      // 透传流式响应
      proxyRes.on('data', chunk => res.write(chunk));
      proxyRes.on('end', () => res.end());
    });
    proxyReq.on('error', (e) => {
      console.error('Proxy error:', e.message);
      res.writeHead(502, {'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({error: 'proxy_failed', message: e.message}));
    });
    proxyReq.write(body);
    proxyReq.end();
  });
}

const server = http.createServer((req, res) => {
  // CORS 预检
  if(req.method === 'OPTIONS'){
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept'
    });
    res.end();
    return;
  }
  // AI 代理
  if(req.method === 'POST' && req.url === '/api/chat'){
    proxyChat(req, res);
    return;
  }
  // 静态文件
  let urlPath = req.url === '/' ? '/index.html' : req.url;
  // 去掉 query string
  urlPath = urlPath.split('?')[0];
  const filePath = path.join(__dirname, urlPath);
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  股票复盘笔记 - 本地代理服务器已启动');
  console.log('═══════════════════════════════════════════════');
  console.log('  浏览器打开: http://localhost:' + PORT);
  console.log('  AI代理:    /api/chat → ' + WB_API_URL);
  console.log('═══════════════════════════════════════════════');
  console.log('  按 Ctrl+C 停止');
});
