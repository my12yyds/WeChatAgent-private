"""Call the existing authenticated local WeChatAgent action API; never publishes."""
import json
import re
import urllib.request
import urllib.parse


def main():
    base = input('控制台地址 [http://127.0.0.1:3210]: ').strip() or 'http://127.0.0.1:3210'
    url = urllib.parse.urlparse(base)
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('只支持本机 http://127.0.0.1:端口')
    base = base.rstrip('/')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(route, token=None, body=None):
        headers = {'Origin': base}
        if token:
            headers['X-Console-Token'] = token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(base+route, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with opener.open(req, timeout=45) as response:
            return json.load(response)
    info = request('/api/info')
    if info.get('project') not in {'WeChatGirl Console', 'WeChatAgent Console'}:
        raise ValueError('目标不是 WeChatGirl 控制台')
    token = info['token']
    catalog = request('/api/plugins', token)
    plugin = next((p for p in catalog['plugins'] if p['id'] == 'persona-moments'), None)
    if not plugin or not plugin['enabled']:
        raise ValueError('请先安装并启用人格定时朋友圈插件')
    chats = plugin.get('chats') or []
    if len(chats) == 1:
        key = chats[0]
        print('使用已配置聊天：'+key)
    else:
        print('已配置聊天：'+', '.join(chats))
        key = input('输入已授权聊天key（如 wechat:private:123）：').strip()
    if not re.fullmatch(r'wechat:(private|group):[1-9][0-9]*', key):
        raise ValueError('聊天key格式错误')
    result = request('/api/plugins/persona-moments/actions/preview', token, {'key':key,'args':{}})
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('预览失败：'+str(e))
        raise SystemExit(1)
