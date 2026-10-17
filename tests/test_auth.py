import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as client:
        reg = await client.post(
            'http://127.0.0.1:8000/api/v1/auth/register',
            json={'email': 'login_test7@example.com', 'password': 'password123', 'full_name': 'Test User'}
        )
        print('Register:', reg.status_code)
        
        login = await client.post(
            'http://127.0.0.1:8000/api/v1/auth/login',
            data={'username': 'login_test7@example.com', 'password': 'password123'}
        )
        print('Login:', login.status_code)
        if login.status_code == 200:
            tokens = login.json()
            at = tokens['access_token']
            rt = tokens['refresh_token']
            print('Access token:', at[:20] + '...')
            print('Refresh token:', rt[:20] + '...')
            
            refresh = await client.post(
                'http://127.0.0.1:8000/api/v1/auth/refresh',
                json={'refresh_token': rt}
            )
            print('Refresh:', refresh.status_code)
            if refresh.status_code == 200:
                new_tokens = refresh.json()
                print('New access:', new_tokens['access_token'][:20] + '...')

asyncio.run(test())