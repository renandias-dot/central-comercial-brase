"""Importa a base do Power Data no app Restaurantes.

Entrada: o CSV de "Download Completo › Gerar CSV" do painel Food Market já com a coluna merchant_id
(saída de juntar.py). Manda as lojas em lotes para a função restaurantes-api (op=import).

Uso:
  RS_CRON_KEY=... python3 importar.py sp_completo.csv
  python3 importar.py sp_completo.csv --url http://localhost:8000 --lote 2000
  python3 importar.py sp_completo.csv --so-conferir   # só valida e mostra a primeira linha convertida

A chave RS_CRON_KEY é a de rs_settings (key = 'cron_key') no banco do app; também aceita o código da equipe
(RESTAURANTES_ACCESS_CODE), se existir.
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.request

URL = 'https://kxabfippeekyxpcgjytx.supabase.co/functions/v1/restaurantes-api'


def digits(s):
    return re.sub(r'\D', '', s or '')


def text(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    return s or None


def number(s, cast=float):
    try:
        return cast(float(s))
    except (TypeError, ValueError):
        return None


def convert(r):
    """Linha do CSV do Power Data → linha que a op=import da função espera."""
    phone = digits(r.get('phone_number')) or digits(r.get('ddd', '') + r.get('phone_if', ''))
    cnpj = digits(r.get('cnpj'))
    stars = number(r.get('user_rating'))
    return {
        'id': (r.get('merchant_id') or '').strip().lower(),
        'name': text(r.get('name')),
        # O Power Data marca o nome da rede com " *" no fim.
        'chain': text(re.sub(r'\s*\*\s*$', '', r.get('merchant_chain') or '')),
        'category': text(r.get('main_category')),
        'price_range': text(r.get('price_range')),
        'street': text(r.get('street_name')),
        'street_number': text(r.get('street_number')),
        'district': text(r.get('district')),
        'city': text(r.get('city')),
        'state': text(r.get('state')),
        'zip': digits(r.get('zip_code')) or None,
        'lat': number(r.get('latitude')),
        'lon': number(r.get('longitude')),
        'phone': phone if len(phone) >= 10 else None,
        'cnpj': cnpj.zfill(14) if 11 <= len(cnpj) <= 14 else None,
        'rating_count': number(r.get('user_rating_count'), int),
        # Nota 0 no Power Data é loja sem nota.
        'stars': stars if stars else None,
        'seen_at': (r.get('date_scrap') or '').strip() or None,
    }


def post(url, key, rows):
    req = urllib.request.Request(url, data=json.dumps({'op': 'import', 'rows': rows}).encode(), method='POST',
                                 headers={'content-type': 'application/json', 'x-rs-cron': key})
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.loads(res.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv')
    ap.add_argument('--url', default=URL)
    ap.add_argument('--lote', type=int, default=2000)
    ap.add_argument('--inicio', type=int, default=0, help='pula as primeiras N linhas (para retomar)')
    ap.add_argument('--so-conferir', action='store_true')
    a = ap.parse_args()

    with open(a.csv, newline='', encoding='utf-8') as f:
        rows = [convert(r) for r in csv.DictReader(f)]
    ok = [r for r in rows if r['id'] and r['name'] and r['seen_at']]
    print(f'{len(rows)} linhas, {len(ok)} com ID, nome e data; {len(rows) - len(ok)} ignoradas')
    if a.so_conferir:
        print(json.dumps(ok[0], ensure_ascii=False, indent=1))
        return

    key = os.environ.get('RS_CRON_KEY', '')
    if not key:
        sys.exit('Defina RS_CRON_KEY com a chave do agendamento (rs_settings) ou o código da equipe.')
    total = {'merchants': 0, 'counts': 0}
    for i in range(a.inicio, len(ok), a.lote):
        lote = ok[i:i + a.lote]
        for tentativa in range(4):
            try:
                r = post(a.url, key, lote)
                break
            except Exception as e:  # rede ou limite passageiro: espera e tenta de novo
                if tentativa == 3:
                    sys.exit(f'Parou na linha {i}: {e}. Rode de novo com --inicio {i}.')
                time.sleep(2 ** (tentativa + 1))
        total['merchants'] += r.get('merchants', 0)
        total['counts'] += r.get('counts', 0)
        print(f'{min(i + a.lote, len(ok))}/{len(ok)} · lojas gravadas {total["merchants"]} · leituras {total["counts"]}', flush=True)
    print('Pronto.')


if __name__ == '__main__':
    main()
