# Coal Finance Tracker 2021

Project with [Global Energy Monitor](https://globalenergymonitor.org) to show Coal Finance flows between countries, financers and coal projects/units

Quickbooks: "CoalSwarm:Coal Project Finance"

* Sidebar with charts and figures
* Map with points for coal projects and financers represented with country centroids

## Hosting

An iframe embedded in a WordPress page. GEM hosts the WordPress site. 

GH pages link: https://greeninfo-network.github.io/coal-finance-2021/

## Development

Pre-requisites:
* Node (>=12.0.0), npm (>=6.14.9), nvm (>= 0.32.1)

To match the development node version:
```bash
nvm use
```

To install required packages (first time only on a new machine):
```bash
npm install
```

To start a development server on `localhost:8080` and watch for changes:
```bash
npm run start
```

## Production
```bash
# build to the docs directory and commit to `main`
npm run build
```
The app is hosted on GitHub pages (via the `docs/` folder).

## Data Management

There are two primary sources
* Country boundaries (see the `documentation/update_country_geojson` directory for details)
* A single Google spreadhsheet is used to manage plant/finance data. https://docs.google.com/spreadsheets/d/1PZ_z36OfC5CWTA3aHdu5z92wQhKe9RsE/edit#gid=615673493

## Data update

1. Save the [data_export tab](https://docs.google.com/spreadsheets/d/1PZ_z36OfC5CWTA3aHdu5z92wQhKe9RsE/edit#gid=1154015836) as `data/data.csv`. **Before export, ensure that there is no formatting on the MW or Fiancer funding fields ($). But do make sure that Sheets formats close_year as a number**. Build (see above) and commit to deploy to GH pages.
2. On major updates, run `documentation/update_country_geojson/make_countries_json.py` to create country boundaries for new countries that may have been added.
