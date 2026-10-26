"""Fictional job seekers for the persona search check (tools/persona-search/run.mjs): writes <out>/<name>/cv.pdf for each one.

Owner, 18 Oct 2026: "check how our app performs for a Financial candidate, in Amsterdam. Or for a music/media/producer in Berlin, or for a basic
(driver) worker in Nurnberg" (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md). Every name, company and address is invented
(example.test); the SRE control is the e2e applicant's own fictional CV (desktop/e2e/fixtures/cv.pdf), copied as is.
Usage: python3 tools/persona-search/personas.py <out dir>
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PERSONAS = {
    'finance': ['Sanne de Vries', 'Senior Financial Analyst (FP&A), Amsterdam, Netherlands', 'sanne.devries@example.test | +31 6 00000000',
                'linkedin.com/in/sanne-devries-example', '', 'SUMMARY',
                'Senior financial analyst with 8 years in FP&A and controlling for Dutch and European companies.',
                'Monthly close, budgeting, forecasting, variance analysis, board reporting. Dutch (native), English (C1).', '',
                'EXPERIENCE', '2021 - now   Senior Financial Analyst, Northwind Retail BV, Amsterdam',
                '  - Own the annual budget and rolling forecast for three business units (EUR 240M revenue).',
                '  - Cut month-end close from 8 to 5 working days; built the variance commentary pack for the CFO.',
                '  - Tools: SAP S/4HANA, Anaplan, Excel (advanced), Power BI, SQL basics.',
                '2018 - 2021  Financial Controller, Tulip Logistics BV, Rotterdam',
                '  - Statutory reporting under Dutch GAAP and IFRS, VAT returns, intercompany reconciliation, audit support.',
                '2016 - 2018  Junior Accountant, Van Dijk & Partners Accountants, Utrecht', '  - Annual accounts and tax filings for SME clients.', '',
                'EDUCATION', 'MSc Finance and Accounting, University of Amsterdam, 2016', 'Certification: CFA Level II passed', '',
                'LANGUAGES', 'Dutch native, English fluent (C1), German basic (A2)', '',
                'WORK RIGHTS', 'Dutch citizen. Lives in Amsterdam, open to hybrid in the Randstad.'],
    'music': ['Jonas Keller', 'Audio and Media Producer, Berlin, Germany', 'jonas.keller@example.test | +49 30 00000000',
              'linkedin.com/in/jonas-keller-example', '', 'SUMMARY',
              'Music and podcast producer with 7 years in studio and post-production. Mixing, mastering, sound design,',
              'sessions with artists and branded audio content for streaming platforms.', '',
              'EXPERIENCE', '2020 - now   Audio Producer, Spreewald Sound Studios GmbH, Berlin',
              '  - Produce, record and mix 40+ releases a year (electronic, indie, hip hop); manage artist sessions.',
              '  - Produced a branded podcast series (12 episodes, 1.2M downloads) for a streaming platform.',
              '  - Tools: Ableton Live, Pro Tools, Logic Pro, iZotope, Reaper, Dolby Atmos mixing.',
              '2018 - 2020  Sound Engineer / Content Producer, KlangKiste Media, Hamburg',
              '  - Live sound, video post-production audio, radio jingles, sound design for ads.',
              '2016 - 2018  Studio Assistant, Funkhaus Berlin', '',
              'EDUCATION', 'BA Audio Production, SAE Institute Berlin, 2016', '',
              'LANGUAGES', 'German (B1), English (C1), Dutch (native)', '',
              'WORK RIGHTS', 'EU citizen. Lives in Berlin. Open to freelance and permanent roles, hybrid.'],
    'driver': ['Marek Nowak', 'Truck driver (CE) and delivery driver, Nuremberg, Germany', 'marek.nowak@example.test | +49 911 0000000', '', '',
               'SUMMARY', 'Reliable professional driver with 9 years of experience in regional and long-distance freight and parcel delivery.',
               'Licence C/CE, ADR basic, forklift licence. Clean driving record.', '',
               'EXPERIENCE', '2019 - now   Truck driver CE, Franken Logistik GmbH, Nuremberg',
               '  - Regional and national freight with 40t trailers, day and night shifts, load securing, digital tachograph.',
               '2016 - 2019  Delivery driver (van, 3.5t), Paket Express Nuernberg',
               '  - Daily parcel route Nuremberg / Fuerth / Erlangen, handheld scanner, customer contact.',
               '2014 - 2016  Warehouse worker and forklift driver, Logistikzentrum Nord, Nuremberg', '',
               'QUALIFICATIONS', 'Driving licence C, CE, B; Code 95 (valid until 2029); ADR basic; Staplerschein (forklift)', '',
               'LANGUAGES', 'Polish native, German (B2), English basic', '',
               'WORK RIGHTS', 'Polish citizen (EU), lives in Nuremberg, looking for a full-time job within about 50 km.'],
    # Owner, 18 Oct 2026: "Add to the search test: Cluj, Romania and Chisinau Moldova. both with IT jobs, Software engineer (backend/frontend/fullstack)."
    'cluj': ['Ioana Marinescu', 'Full-stack Software Engineer (backend / frontend), Cluj-Napoca, Romania', 'ioana.marinescu@example.test | +40 700 000 000',
             'github.com/ioana-marinescu-example', '', 'SUMMARY',
             'Full-stack software engineer with 6 years building web products: Java and Node.js backends, React frontends, cloud deployments.',
             'Comfortable across the stack; prefers product teams. Romanian (native), English (C1).', '',
             'EXPERIENCE', '2021 - now   Senior Software Engineer, Somes Digital SRL, Cluj-Napoca',
             '  - Backend services in Java 17 / Spring Boot and Node.js (TypeScript), REST and GraphQL APIs, PostgreSQL, Kafka.',
             '  - Frontend in React and Next.js; design system components, accessibility, end-to-end tests with Playwright.',
             '  - AWS (ECS, Lambda, RDS), Docker, Terraform basics, CI/CD with GitHub Actions.',
             '2018 - 2021  Software Engineer, Transilvania Soft SRL, Cluj-Napoca',
             '  - Outsourcing projects for EU clients: Angular frontends, .NET and Java backends, SQL Server.',
             '2017 - 2018  Junior Frontend Developer, Feleac Web Studio, Cluj-Napoca', '',
             'EDUCATION', 'BSc Computer Science, Babes-Bolyai University, Cluj-Napoca, 2017', '',
             'LANGUAGES', 'Romanian native, English fluent (C1), German basic (A2)', '',
             'WORK RIGHTS', 'Romanian citizen (EU). Lives in Cluj-Napoca; on-site, hybrid or remote from Romania.'],
    'chisinau': ['Victor Rusu', 'Backend / Full-stack Software Engineer, Chisinau, Moldova', 'victor.rusu@example.test | +373 60 000 000',
                 'github.com/victor-rusu-example', '', 'SUMMARY',
                 'Software engineer with 5 years on backend systems and web apps: Python, Go and Node.js services, React frontends.',
                 'Romanian (native), Russian (fluent), English (B2).', '',
                 'EXPERIENCE', '2022 - now   Software Engineer, Codru Systems SRL, Chisinau',
                 '  - Backend in Python (Django, FastAPI) and Go; PostgreSQL, Redis, RabbitMQ; payment and billing APIs.',
                 '  - Frontend features in React and TypeScript for an internal admin app.',
                 '  - Docker, Kubernetes basics, Linux, CI/CD with GitLab.',
                 '2019 - 2022  Full-stack Developer, Nistru Web SRL, Chisinau',
                 '  - PHP (Laravel) and Vue.js projects for local and EU clients; MySQL; REST integrations.', '',
                 'EDUCATION', 'BSc Software Engineering, Technical University of Moldova, Chisinau, 2019', '',
                 'LANGUAGES', 'Romanian native, Russian fluent, English upper-intermediate (B2)', '',
                 'WORK RIGHTS', 'Moldovan citizen (also holds Romanian citizenship, EU). Lives in Chisinau; on-site, hybrid or remote from Moldova.'],
    'pilot': ['Lukas Brenner', 'First Officer A320 (airline pilot), Vienna, Austria', 'lukas.brenner@example.test | +43 660 0000000',
              'linkedin.com/in/lukas-brenner-example', '', 'SUMMARY',
              'Airline First Officer with 2,800 hours, 2,300 on the A320 family, in short- and medium-haul scheduled and charter flying.',
              'EASA ATPL (frozen ATPL theory passed), A320 type rating current, MCC/JOC, Class 1 medical. German (native), English (ICAO level 6).', '',
              'EXPERIENCE', '2021 - now   First Officer A320, Alpenflug Airways (example), Vienna base',
              '  - Scheduled and charter flights across Europe, North Africa and the Middle East; 600+ sectors a year.',
              '  - Line training completed 2021; recurrent LPC/OPC passed every year; CRM and dangerous goods current.',
              '2019 - 2021  Flight Instructor (FI), Danube Flight Academy (example), Wiener Neustadt',
              '  - PPL and CPL training on DA40 / DA42; 900 hours of instruction.', '',
              'EDUCATION', 'Integrated ATPL course, Danube Flight Academy (example), 2019', '',
              'LANGUAGES', 'German native, English fluent (ICAO 6), Italian basic', '',
              'WORK RIGHTS', 'Austrian citizen (EU). Open to any airline base in Europe; ready to relocate. Flying is on-site.'],
}


def pdf(lines):
    """A one-page PDF of these lines (Helvetica 10 pt), built like desktop/e2e/fixtures/make-personas.py's: no PDF library needed."""
    esc = lambda t: t.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = 'BT /F1 10 Tf 40 800 Td 14 TL\n' + '\n'.join(f'({esc(line)}) Tj T*' for line in lines) + '\nET'
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
               f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    out, offsets = '%PDF-1.4\n', []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out.encode('latin-1')))
        out += f'{n} 0 obj\n{body}\nendobj\n'
    xref = len(out.encode('latin-1'))
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offsets)
    return (out + f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n').encode('latin-1')


def write(out):
    for name, lines in PERSONAS.items():
        (out / name).mkdir(parents=True, exist_ok=True)
        (out / name / 'cv.pdf').write_bytes(pdf(lines))
    (out / 'sre').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'desktop' / 'e2e' / 'fixtures' / 'cv.pdf', out / 'sre' / 'cv.pdf')
    return [*PERSONAS, 'sre']


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(' '.join(write(Path(sys.argv[1]))))
