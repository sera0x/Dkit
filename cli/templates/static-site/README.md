# {{Name}}

Static site scaffolded with `dkit new --template static-site`.

Every deploy logs to Dkit — edit `scripts/deploy.js` to actually publish
(rsync / netlify / s3 — your call), then:

    npm run deploy
    dkit logs:tail -s deploy
