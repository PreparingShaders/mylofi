import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
OPENROUTER_KEY = os.getenv("OPEN_ROUTER_API_KEY")

PROXY_URL = "https://inspectorgpt.classname1984.workers.dev"

# ----------------------------------------------------------------------
# 1. ПОЛУЧЕНИЕ СПИСКА VISION-МОДЕЛЕЙ
# ----------------------------------------------------------------------

def get_gemini_vision_models():
    """Запрашивает список моделей Gemini и оставляет только поддерживающие Vision."""
    url = f"{PROXY_URL}/v1beta/models?key={GEMINI_KEY}"
    try:
        res = requests.get(url, timeout=15)
        if res.status_code != 200:
            print(f"❌ Ошибка получения списка Gemini моделей: {res.status_code}")
            return []
        
        data = res.json()
        vision_models = []
        for m in data.get('models', []):
            name = m.get('name', '').replace('models/', '')
            methods = m.get('supportedGenerationMethods', [])
            
            # Нам нужны модели, поддерживающие генерацию контента
            if 'generateContent' not in methods:
                continue
            
            # Фильтр по названию / назначению (все современные flash/pro/experimental умеют в Vision)
            # Отсекаем текстовые/эмбеддинг/аудио модели
            if any(term in name.lower() for term in ['flash', 'pro', 'vision', 'ultra']) and not any(term in name.lower() for term in ['embedding', 'text-bison', 'aqa', 'imagen']):
                vision_models.append(name)
                
        return vision_models
    except Exception as e:
        print(f"❌ Исключение при получении Gemini моделей: {e}")
        return []

def get_openrouter_vision_models(only_free=True):
    """Запрашивает список моделей OpenRouter и фильтрует мультимодальные (Vision)."""
    url = f"{PROXY_URL}/v1/models"
    headers = {"Authorization": f"Bearer {OPENROUTER_KEY}"}
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200:
            print(f"❌ Ошибка получения списка OpenRouter моделей: {res.status_code}")
            return []
        
        data = res.json()
        vision_models = []
        
        for m in data.get('data', []):
            model_id = m.get('id', '')
            architecture = m.get('architecture', {})
            modality = architecture.get('modality', '')
            
            # Проверяем, поддерживает ли модель входные изображения (multimodal или image->text)
            is_vision = 'image' in modality.lower() or 'multimodal' in modality.lower()
            
            # Если нужен только бесплатный пул (с суффиксом :free)
            if only_free and not model_id.endswith(':free'):
                continue
                
            if is_vision:
                vision_models.append(model_id)
                
        return vision_models
    except Exception as e:
        print(f"❌ Исключение при получении OpenRouter моделей: {e}")
        return []

# ----------------------------------------------------------------------
# 2. ТЕСТИРОВАНИЕ МОДЕЛЕЙ
# ----------------------------------------------------------------------

def test_model(model_name, is_gemini=True):
    print(f"Тестируем: {model_name:.<45}", end=" ", flush=True)

    headers = {"Content-Type": "application/json"}

    if is_gemini:
        url = f"{PROXY_URL}/v1beta/models/{model_name}:generateContent?key={GEMINI_KEY}"
        payload = {"contents": [{"parts": [{"text": "Say OK"}]}]}
    else:
        url = f"{PROXY_URL}/v1/chat/completions"
        headers["Authorization"] = f"Bearer {OPENROUTER_KEY}"
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": "Say OK"}]
        }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=20)

        if response.status_code != 200:
            print(f"❌ Код {response.status_code}")
            return False

        res_data = response.json()

        if is_gemini:
            candidates = res_data.get('candidates', [])
            if not candidates:
                print("❌ Пустой ответ")
                return False
            text = candidates[0]['content']['parts'][0]['text']
        else:
            text = res_data['choices'][0]['message']['content']

        if "OK" in text.upper():
            print("✅ OK")
            return True
        else:
            print(f"⚠️ Ответила: {text.strip()[:20]}...")
            return True # Тоже считаем рабочей, т.к. модель ответила

    except Exception as e:
        print(f"❌ Ошибка обработки")
        return False

# ----------------------------------------------------------------------
# 3. ОСНОВНОЙ СЦЕНАРИЙ
# ----------------------------------------------------------------------

def main():
    print("=" * 65)
    print("ПОЛУЧЕНИЕ И ПРОВЕРКА VISION-МОДЕЛЕЙ ЧЕРЕЗ PROXY WORKER")
    print("=" * 65)

    # 1. Получаем списки
    print("\n🔍 Запрашиваем актуальный список Vision-модели от Gemini...")
    gemini_models = get_gemini_vision_models()
    print(f"   Найдено Gemini Vision моделей: {len(gemini_models)}")

    print("\n🔍 Запрашиваем актуальный список Vision-модели от OpenRouter (Free)...")
    openrouter_models = get_openrouter_vision_models(only_free=True)
    print(f"   Найдено OpenRouter Free Vision моделей: {len(openrouter_models)}")

    working_gemini = []
    working_or = []

    # 2. Тестируем Gemini
    print("\n[1] ТЕСТИРОВАНИЕ GEMINI VISION")
    for m in gemini_models:
        if test_model(m, is_gemini=True):
            working_gemini.append(m)

    # 3. Тестируем OpenRouter
    print("\n[2] ТЕСТИРОВАНИЕ OPENROUTER VISION (FREE)")
    for m in openrouter_models:
        if test_model(m, is_gemini=False):
            working_or.append(m)

    # 4. Итоговый отчет
    print("\n" + "=" * 65)
    print("РЕЗУЛЬТАТЫ ПРОВЕРКИ VISION-МОДЕЛЕЙ:")
    print("=" * 65)
    
    print(f"\n✅ Рабочие Gemini Vision ({len(working_gemini)}):")
    for m in working_gemini:
        print(f"  - '{m}'")

    print(f"\n✅ Рабочие OpenRouter Free Vision ({len(working_or)}):")
    for m in working_or:
        print(f"  - '{m}'")


if __name__ == "__main__":
    main()