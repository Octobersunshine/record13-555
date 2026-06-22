import hmac
import hashlib
import json
import time
import uuid
import requests
import os
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv('SIGNATURE_SECRET_KEY', 'your_super_secret_key_here_2024')
APP_ID = 'client_app_001'
BASE_URL = f"http://localhost:{os.getenv('PORT', '3000')}"


def generate_signature(method, path, timestamp, nonce, app_id, body):
    body_str = json.dumps(body, separators=(',', ':')) if body else ''
    sign_str = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{app_id}\n{body_str}"
    
    print('签名原始字符串:')
    print(sign_str)
    print('---')
    
    return hmac.new(
        SECRET_KEY.encode('utf-8'),
        sign_str.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()


def generate_nonce():
    return uuid.uuid4().hex


def send_request(method, path, body=None):
    timestamp = str(int(time.time() * 1000))
    nonce = generate_nonce()
    signature = generate_signature(method, path, timestamp, nonce, APP_ID, body)
    
    headers = {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-App-Id': APP_ID,
        'X-Signature': signature
    }
    
    print(f"\n=== {method} {path} ===")
    print('请求头:', json.dumps(headers, indent=2, ensure_ascii=False))
    if body:
        print('请求体:', json.dumps(body, indent=2, ensure_ascii=False))
    
    url = f"{BASE_URL}{path}"
    
    try:
        if method.upper() == 'GET':
            response = requests.get(url, headers=headers)
        elif method.upper() == 'POST':
            response = requests.post(url, headers=headers, json=body)
        elif method.upper() == 'PUT':
            response = requests.put(url, headers=headers, json=body)
        elif method.upper() == 'DELETE':
            response = requests.delete(url, headers=headers)
        else:
            raise ValueError(f"不支持的方法: {method}")
        
        print('响应状态:', response.status_code)
        print('响应数据:', json.dumps(response.json(), indent=2, ensure_ascii=False))
        return response
    except Exception as e:
        print(f'请求失败: {e}')
        raise


def main():
    try:
        send_request('GET', '/api/public/health')
        send_request('GET', '/api/user/info')
        send_request('POST', '/api/order/create', {
            'productId': 'PROD001',
            'quantity': 2,
            'amount': 199.99
        })
        send_request('PUT', '/api/user/profile', {
            'nickname': '新昵称',
            'avatar': 'https://example.com/avatar.jpg'
        })
        send_request('DELETE', '/api/order/ORD123456')
    except Exception as e:
        print(f'执行失败: {e}')


if __name__ == '__main__':
    main()
