# Search reporting phases: scheduled maintenance, digest delivery and saved run summaries.
import json
import sys
from datetime import timezone
from . import digest, doctor, features, ledger_store, notify, store, telegram
from .ai import budget, insights, interviews
from .notion import funnel
from .daily_helpers import digest_note


# Maintain scheduled applications and the Notion-only funnel.
def scheduled_updates(args, stores, run, open_urls, datetime):
    if args.mode == 'scheduled':
        # Application ledger (src/ledger_store.py, any store): log Stage edits, and mark silent applications No response.
        try:
            print(ledger_store.sync(stores))
        except Exception as error:
            print(f'Warning: ledger sync skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'ledger sync skipped: {type(error).__name__}')
        # Saved / Kit ready jobs whose posting was taken down (their board confirms it) → Closed, named in the report.
        try:
            summary, run['gone_titles'] = ledger_store.close_gone(stores, open_urls)
            print(summary)
        except Exception as error:
            print(f'Warning: taken-down check skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'taken-down check skipped: {type(error).__name__}')
        # A recorded interview whose application still says Interview scheduled (saved before the app moved it on).
        try:
            print(interviews.sweep(stores=stores))
        except Exception as error:
            print(f'Warning: interview sweep skipped: {type(error).__name__}: {error}')
    if args.mode == 'scheduled' and stores.name == 'notion' and not features.disabled('notion'):
        # 🎯 Pipeline page: conversion between funnel steps and the step to improve (no AI). Notion only: the notion adapter writes it.
        try:
            funnel.write(stores, funnel.funnel(funnel.reached(stores)),
                         datetime.now(timezone.utc).strftime('%d %b %H:%M UTC'))
        except Exception as error:
            print(f'Warning: funnel update skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'funnel update skipped: {type(error).__name__}')


# Write report files, preview or send the digest, and save the run.
def finish_search(args, stores, run, spend, report, imported, messages, new_count, keyboards, shown_ids, seed, reports, datetime, save_run, log_crawl):
    text = '\n\n'.join(messages)
    reports.mkdir(parents=True, exist_ok=True)
    (reports / 'daily-latest.txt').write_text(text + '\n', encoding='utf-8')
    (reports / 'daily-latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    if sys.stdout.isatty():  # the Telegram HTML is a preview for a terminal; the app's log gets a summary line
        print(text)
    if not args.send:
        if not sys.stdout.isatty():
            telegram.to_app(text)  # the desktop app shows the list itself
        print('\n' + digest_note(len(shown_ids), new_count, terminal=sys.stdout.isatty()))
        if args.mode in ('scheduled', 'run', 'today'):
            save_run(run)  # the desktop app's activity bar shows its counts
            if args.log_run:
                log_crawl(stores, run)
        return 0
    token, chat_id = telegram.credentials()
    deliver_digest(args, run, imported, messages, new_count, keyboards, shown_ids, seed, token, chat_id)
    after_delivery(args, stores, run, spend, token, chat_id, datetime)
    if args.mode in ('scheduled', 'run', 'today'):
        save_run(run)
        log_crawl(stores, run)  # sending runs; a terminal preview (no --send) isn't logged unless --log-run
    return 0


# Record delivery success and mark shown jobs only after successful delivery.
def deliver_digest(args, run, imported, messages, new_count, keyboards, shown_ids, seed, token, chat_id):
    if args.mode == 'scheduled' and not new_count:
        print('\nNo new jobs since the last run; nothing sent.')
        run['telegram'] = 'nothing new; not sent'
    else:
        refused = send_messages(messages, keyboards, token, chat_id)
        if refused:
            # The jobs are imported and saved; only the delivery failed. Not marked as shown, so the next digest lists them again.
            print(f'Warning: {refused}')
            run['telegram'] = 'not sent: the e-mail was refused' if not token else 'not sent: Telegram refused it'
        else:
            if args.mode != 'more':
                # '➕ Next' runs don't save the database, so only first pages count for rotation.
                with store.connect(args.db) as db:
                    digest.mark_shown(db, shown_ids, seed)
            print(f"\nSent {len(messages)} {'Telegram message(s)' if token else 'message(s) by e-mail'}; imported {len(imported)} jobs.")
            run['telegram'] = f'sent {len(messages)} message(s), {new_count} new'


# Send messages and flush email, returning the original refusal words.
def send_messages(messages, keyboards, token, chat_id):
    refused = None
    for message, keyboard in zip(messages, keyboards):
        try:
            telegram.send(message, token, chat_id, keyboard, kind='matches')
        except Exception as error:  # a blocked bot, a removed chat, no network: the run says so in words, it does not crash
            refused = telegram.failure_words(error)
            break
    if not refused and notify.wants_email() and not notify.flush('matches') and not token:   # the digest's e-mail goes now, so a failure keeps the jobs unshown like a refused Telegram message
        refused = notify.failure_words()
    return refused


# Run the existing budget, health and insight steps after delivery.
def after_delivery(args, stores, run, spend, token, chat_id, datetime):
    if spend and not run.get('telegram', '').startswith('not sent'):
        with store.connect(args.db) as db:
            budget.alert_once(db, spend, lambda text: telegram.send(text, token, chat_id))
    if args.mode == 'scheduled' and datetime.now(timezone.utc).hour == doctor.HEALTH_HOUR_UTC:
        # Once a day: one Telegram line if a health check fails (Google sign-in, mail, budget, feeds).
        try:
            print(doctor.alert(stores, lambda text: telegram.send(text, token, chat_id)))
        except Exception as error:
            print(f'Warning: health check skipped: {type(error).__name__}: {error}')
    if args.insight and args.mode == 'scheduled':
        # One insight a day, with the first scheduled run after insights.SEND_HOUR_UTC.
        try:
            run['insight'] = {}
            with store.connect(args.db) as db:
                print(insights.run(db, stores, send=lambda text, markup: telegram.send(text, token, chat_id, markup),
                                   stats=run['insight']))
        except Exception as error:
            print(f'Warning: insight skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'insight skipped: {type(error).__name__}')
