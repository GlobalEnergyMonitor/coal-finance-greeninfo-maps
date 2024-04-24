///////////////////////////////////////////////////////////////////////////////////////////////////////////
// IMPORTS
///////////////////////////////////////////////////////////////////////////////////////////////////////////
import MobileDetect from 'mobile-detect';
import * as JsSearch from 'js-search';

///////////////////////////////////////////////////////////////////////////////////
// STYLES, in production, these will be written to <script> tags
///////////////////////////////////////////////////////////////////////////////////
import './loading.css';
import styles from './index.scss';

///////////////////////////////////////////////////////////////////////////////////////////////////////////
// GLOBAL VARIABLES & STRUCTURES
///////////////////////////////////////////////////////////////////////////////////////////////////////////
// global config
const CONFIG = {};
const DATA = {};

// minzoom and maxzoom for the map
CONFIG.minzoom = 2;
CONFIG.maxzoom = 15;

// pad the map extent by this much, in addition to the sidebar padding, see fitBoundsWithOffset()
CONFIG.mapPad = 20; 

// Style definitions (see also scss exports, which are imported here as styles{})
// a country outline style
CONFIG.country_style = { stroke: true, color: '#666', opacity: 1, weight: 0.5, fillColor: styles.countrystyle, fillOpacity: 0.1 };
// feature highlight styles, shows below features on hover or click
CONFIG.feature_hover_style  = { color: '#fff5a3', fillOpacity: 1, stroke: true, weight: 13, opacity: 1 };
CONFIG.feature_select_style = { color: '#f2e360', fillOpacity: 1, stroke: true, weight: 13, opacity: 1 };

// Spatial-sankey config for options, svg styles, etc.
CONFIG.minradius = 10; // min size in pixels, for a scaled point
CONFIG.maxradius = 40; // max size in pixels, for a scaled poin
CONFIG.sourcecolor = styles.sourcecolor;
CONFIG.sourcecolor_light = styles.sourcecolor_light;
CONFIG.targetcolor = styles.targetcolor;
CONFIG.targetcolor_light = styles.targetcolor_light;
CONFIG.circle_opacity = 1;
CONFIG.node_flow_range = {};
CONFIG.link_flow_range = {};

// Sidebar and other element constants
CONFIG.sidebarwidth = styles.sidebarwidth * 1; // cast as number

// Pie chart colors
CONFIG.piechart_colors = {
  "Privately-owned commercial institution": "#7a9e9f",
  "Governmental policy institution": "#eef5db",
  "Government-owned commercial institution": "#4f6367",
  // "To be determined": "#90ed7d",
  "Joint venture": "#90ed7d",
  "Unknown": "#cecece",
}

CONFIG.format = {
  // return as is
  'string': function(s) { return s },
  // string to number with 0 decimals
  'number': function(n) {
    return parseFloat(n).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0});
  },
  // string to float with two decimals
  'float': function(n) {
    return parseFloat(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  },
  // string to number with as many output decimals as input
  'variable_float': function(n) {
    if (isNaN(n)) return n;
    let num = Math.round((+n + Number.EPSILON) * 100) / 100; 
    if (num < 11) {
      return parseFloat(num).toLocaleString('en-US');
    } else {
      return parseFloat(num).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0}); 
    }
  },
  // if entered value is NaN, then return it, otherwise same as number, above
  'mixed':  function(m) { return isNaN(m) ? m : CONFIG.format['number'](m) },
}

// track loading state
CONFIG.first_load = true;


///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// INITIALIZATION: these functions are called when the page is ready,
///////////////////////////////////////////////////////////////////////////////////////////////////////////
$(document).ready(function () {

  // data initialization first, then the remaining init steps
  Promise.all([initData('./data/data.csv'), initData('./data/countries.json')])
    .then(function(data) {
      initDataFormat(data);    // get data ready for use
      initLeafletShims();      // Leaflet extensions and shims
      initD3();                // D3 inits
      initMap();               // basic map inits
      initSelects();           // init selects using Select2
      initButtons();           // various button inits
      initSearch();            // init the JQ typeahead search
      initTippyTooltips();     // init the info icon tooltips

// console.log("%cDATA", "color:green", DATA);
// console.log("%cCONFIG", "color:red", CONFIG);

      // ready!
      setTimeout(function () {
        CONFIG.first_load = false;    // done loading

        // kick off the application
        prepareMapAndCharts();
        initSearchTerms(); // must be done after initial data filter is done

        // ready!
        $("div#loading").hide();      
      }, 200);
    }); // Promise.then()
});

///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// FUNCTIONS CALLED ON DOC READY
///////////////////////////////////////////////////////////////////////////////////////////////////////////

// Basic data init, returns a promise
function initData(url) {
  // wrap this in a promise, so we know we have it before continuing on to remaining initialize steps
  return new Promise(function(resolve, reject) {
    $.get(url, function(data) {
      resolve(data);
    });
  });
}

// Data formatting routines, to get the static, raw data files into the form we need it in
function initDataFormat(data) {
  // set country data equal to the second data object from the initData() Promise()
  DATA.country_data = data[1];

  // parse and format the finance data from CSV
  var data = Papa.parse(data[0], {header: true, skipEmptyLines: 'greedy'});

  // Testing mode, or query params? You decide:
  // allow URL param to limit the universe of data to a single source country
  if (window.location.search) {
    let params = new URLSearchParams(window.location.search)
    let country = params.get('country');
    if (country) {
      let datar = data.data.filter(function(d) { return d.source == country && d.era == "financing" });
      data.data = datar;
    }
  }

  // check for data to skip
  let rawdata = [], years = [], finance_types = [];
  data.data.forEach(function(d) {
    if (! d.era ) return; 
    if (! d.target_lat || isNaN(d.target_lat)) return;
    if (! d.target_lng || isNaN(d.target_lng)) return;
    if (! d.source_lat || isNaN(d.source_lat)) return;
    if (! d.source_lng || isNaN(d.source_lng)) return;
    if (! d.target_country_lat || isNaN(d.target_country_lat)) return;
    if (! d.target_country_lng || isNaN(d.target_country_lng)) return;
    if ( d.megawatts == "" ) return; // skip blank MW, but keep 0's
    if (d.source == "" || d.target == "") return; // skip blank sources and targets

    // formatting
    if (d.finance_type === "" || d.finance_type === "n/a") d.finance_type = "unknown";
    d.megawatts = +d.megawatts; 
    d.dollars = isNaN(d.dollars) ? 0 : +d.dollars // attempt to clean bad values from dollars (e.g. N/A), and also convert to integer
    rawdata.push(d);

    // collect close year for use in a year filter
    // NOTE: year filter is disabled unless era = 'closed'
    if (d.era == "closed") years.push(d.close_year);
  });

  // keep a reference to this geojson in DATA
  DATA.rawdata = rawdata;

  // construct the default home bounds from the data
  let datar = DATA.rawdata.filter(function(d) { return d.era == "financing" });
  let lats1 = datar.map(function(d) { return +d.target_country_lat });
  let lats2 = datar.map(function(d) { return +d.source_lat });
  let lats = lats1.concat(lats2);
  let lngs1 = datar.map(function(d) { return +d.target_country_lng });
  let lngs2 = datar.map(function(d) { return +d.source_lng });
  let lngs = lngs1.concat(lngs2);
  let xmin = d3.min(lngs);
  let xmax = d3.max(lngs);
  let ymin = d3.min(lats);
  let ymax = d3.max(lats);
  console.log(datar)
  console.log(ymin)
  console.log(xmin)
  console.log(ymax)
  console.log(xmax)

  CONFIG.homebounds = [[ymin, xmin],[ymax, xmax]];

  // organize data according to two different target concepts: targets as country centoids, and targets as projects
  DATA.target_countries = []; 
  DATA.rawdata.forEach(function(e) {
    let d = JSON.parse(JSON.stringify(e));
    d.project_name = d.target;
    d.target = d.country;
    d.target_lat = d.target_country_lat;
    d.target_lng = d.target_country_lng;
    DATA.target_countries.push(d);
  });

  // target projects: this is a lot easier, as this is how the data is already organized in the spreadsheet
  DATA.target_projects = DATA.rawdata;

  // reduce years to a single, sorted set, and keep a reference
  // we use these to populate select#close_year, see initSelects()
  CONFIG.years = uniq(years).sort();
}

// Leaflet inits
function initLeafletShims() {
  // a hack for deciding whether or not to pad the map bounds
  L.Map.prototype.fitBoundsWithOffset = function (bounds, options) {
    // not mobile, either not mobile, or mobile and wider than iPad portrait
    var notmobile = ! isMobile() || $(window).width() > 767;
    var sidebarvisible = $('div#sidebar').offset().left >= 0;
    if (notmobile && sidebarvisible) {
      options = { 
        paddingTopLeft: [CONFIG.sidebarwidth, CONFIG.mapPad],
        paddingBottomRight: [ 0, CONFIG.mapPad]
      };
    }
    return this.fitBounds(bounds, options);
  };
}

// Tippy tooltips
function initTippyTooltips() {
  // not much to it: 
  tippy('.info-icon-wrap', {
    trigger: 'click',
    interactive: true,
    allowHTML: true,
  });
}

// D3 inits for scales, formatting functions and the like
function initD3() {
  // set up a linear scale for the sidebar "chart" bar widths above each country name
  CONFIG.barscale = function(max) {
    // from 2px to the width of the sidebar, minus sufficient padding to fit labels
    // use the actual sidebar width here, not CONFIG.sidebarwidth, because on mobile, width is 100% 
    var range = [2, $("div#sidebar").width() - 150];
    var barscale = d3.scaleLinear()
      .domain([0,max])
      .range(range);    
    return barscale;      
  }

  // set up formatting functions
  CONFIG.format = {
    "megawatts": function(n) { return d3.format(",.0f")(n) + " MW"; },
    "dollars": function(n) { 
      if (n > 1000000) {
        n = n / 1000000;
        return d3.format("($,.0f")(n) + "M";
      } else {
        return d3.format("($,.0f")(n);
      }
    }
  }

  // set up a tooltip for the D3 elements
  CONFIG.tooltip = d3.select("body")
    .append("div")
    .classed("map-tooltip",true);

  // function to calculate node cx
  CONFIG.calc_node_cx = function(d) {
    // note we have to swap lat/lng for x/y
    let cx = CONFIG.map.latLngToLayerPoint([d.geometry.coordinates[1],d.geometry.coordinates[0]]).x;
    if (!cx) return null;
    return cx;
  }


  // function to calculate node cy
  CONFIG.calc_node_cy = function(d) {
    // note we have to swap lat/lng for x/y
    let cy = CONFIG.map.latLngToLayerPoint([d.geometry.coordinates[1],d.geometry.coordinates[0]]).y;
    if (!cy) return null;
    return cy;
  }

  // function to calculate node radius based on inflows
  CONFIG.calc_node_r_inflows = function(d) {
    if (d.properties.aggregate_inflows == 0) return 0;
    let diff = d.properties.aggregate_inflows - CONFIG.node_flow_range.min;
    let range = CONFIG.node_flow_range.max - CONFIG.node_flow_range.min;
    let r = (CONFIG.maxradius - CONFIG.minradius)*(diff/range) + CONFIG.minradius;
    return r;
  }

  // function to calculate node radius based on outflows
  CONFIG.calc_node_r_outflows = function(d) {
    if (d.properties.aggregate_outflows == 0) return 0;
    let diff = d.properties.aggregate_outflows - CONFIG.node_flow_range.min;
    let range = CONFIG.node_flow_range.max - CONFIG.node_flow_range.min;
    return (CONFIG.maxradius - CONFIG.minradius)*(diff/range) + CONFIG.minradius;
  }

  // Define the path drawing function used for links in drawLinks()
  CONFIG.calc_link_path = function(d) {
    // Setting these as constants
    let sx = 0.4;
    let sy = 0.1;

    // Set control point inputs
    let source = CONFIG.map.latLngToLayerPoint(d.source_coords),
        target = CONFIG.map.latLngToLayerPoint(d.target_coords),
        dx = source.x - target.x,
        dy = source.y - target.y;

    // Determine control point locations (note: there are additional options here in the original spatialsankey.js that we do not consider)
    let controls;
    if (dy < 0) {
      controls = [sx*dx, sy*dy, sx*dx, sy*dy]
    } else {
      controls = [sy*dx, sx*dy, sy*dx, sx*dy]
    }

    let link = "M" + source.x + "," + source.y
         + "C" + (source.x - controls[0]) + "," + (source.y - controls[1])
         + " " + (target.x + controls[2]) + "," + (target.y + controls[3])
         + " " + target.x + "," + target.y;
  
    // what the heck is this? 
    // let target = "a";

    return link;
  };

  // The function that sets the link width based on data range and width range setting
 CONFIG.link_width_function = function(d) {
    // Width range of lines, set min and max to be equal for a constant width
    // these could be set elsewhere, but I've never felt the need to alter these defaults
    let width_range = {min: 2, max: 20};

    // Don't draw flows with zero flow unless zero is the minimum
    if( d.flow == 0 && CONFIG.link_flow_range.min != 0 ) return 0;
    // Calculate width value based on flow range
    let diff = d.flow - CONFIG.link_flow_range.min;
    let range = CONFIG.link_flow_range.max - CONFIG.link_flow_range.min;
    return (width_range.max - width_range.min)*(diff/range) + width_range.min;
  };
}

// initialize the map in the main navigation map tab
function initMap() {
  // basic leaflet map setup
  CONFIG.map = L.map('map', {
    attributionControl: false,
    zoomControl: false,
    minZoom: CONFIG.minzoom, maxZoom: CONFIG.maxzoom,
  });

  // map panes
  // - create panes for the carto streets basemap and labels
  CONFIG.map.createPane('basemap'); 
  CONFIG.map.getPane('basemap').style.zIndex = 200;
  CONFIG.map.createPane('basemap-labels'); 
  CONFIG.map.getPane('basemap-labels').style.zIndex = 800;

  // - create map panes for countries and country interactions, which will sit between the basemap and labels
  CONFIG.map.createPane('country-outline');
  CONFIG.map.getPane('country-outline').style.zIndex = 300;
  CONFIG.map.createPane('country-hover');
  CONFIG.map.getPane('country-hover').style.zIndex = 350;
  CONFIG.map.createPane('country-select');
  CONFIG.map.getPane('country-select').style.zIndex = 400;

  // create an empty feature group to hold country borders/polygons, to highlight countries in the list
  CONFIG.country_layers = L.featureGroup([], { pane: 'country-outline' }).addTo(CONFIG.map);

  // add attribution
  var credits = L.control.attribution({ 
    prefix: 'Interactive mapping by <a href="http://greeninfo.org" target="_blank">GreenInfo Network</a>. Data: <a href="https://globalenergymonitor.org/" target="_blank">Global Energy Monitor</a>',
    position: 'bottomright' 
  }).addTo(CONFIG.map);

  // add the custom zoom home control
  new L.Control.ZoomBar({
    position: 'bottomright',
    // homeLatLng: [CONFIG.startlat, CONFIG.startlng],
    // homeZoom: CONFIG.startzoom,
    homeBounds: CONFIG.homebounds,
  }).addTo(CONFIG.map);

  // Fit the map to the homebounds 
  CONFIG.map.fitBoundsWithOffset(CONFIG.homebounds); 

  // add the one and only basemap, and labels
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}' + (L.Browser.retina ? '@2x.png' : '.png'), { pane: 'basemap' }).addTo(CONFIG.map);
  L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}' + (L.Browser.retina ? '@2x.png' : '.png'), { pane: 'basemap-labels' }).addTo(CONFIG.map);

  // init the svg layer for D3
  var svglayer = L.svg();
  svglayer.addTo(CONFIG.map);

  // disable all map interactions through these divs
  let divs = ['filter-outer', 'search-wrapper', 'chart-wrapper'];
  divs.forEach(function(div) {
    let el = document.getElementById(div);
    L.DomEvent.on(el, "click", L.DomEvent.stopPropagation);
    L.DomEvent.disableScrollPropagation(el);
    L.DomEvent.disableClickPropagation(el);
  })
}

// init the typeahead search
function initSearch() {
  CONFIG.search_input = $.typeahead({
    input: "input#search",
    minLength: 0, // make this > 0 so that the list doesn't show when you click the input
    maxItem: 1000, // make this large enough so _everything_ shows in the list, nothing truncated
    maxItemPerGroup: 250, // additive per group, until maxItem is reached
    order: "asc",
    hint: true,
    searchOnFocus: true,
    emptyTemplate: "no result for {{query}}",
    correlativeTemplate: true,
    group: true,
    // see #44. This doesn't play well with dynamic options
    dropdownFilter: false,
    source: [], // empty initially, see initSearchTerms(); 
    debug: false,
    // this seems to be the only api to the selected groups
    // one still has to click the search button to trigger the search (though we could trigger it here on click)
    callback: {
      // called when the typeahead results open below the input#search
      onShowLayout: function() {
        // stop propogation to the map
        let el = document.getElementsByClassName('typeahead__result')[0];
        L.DomEvent.on(el, 'click', L.DomEvent.stopPropagation);
        L.DomEvent.disableScrollPropagation(el);
        L.DomEvent.disableClickPropagation(el);
      },

      // called when the typeahead results close 
      onHideLayout: function () {
        // on mobile, loads of conflicts here between the search options and other elements
        if (isMobile()) {
          // undo the hide on open
          $('div.toggle-wrapper').show();
        };
      },

      // called after we click an item in the list
      onClickAfter: function (node, a, item, event) {
        // don't actually submit anything, yet
        event.preventDefault;

        // capture the clicked item, for use in our search filtering
        // see #search-filter submit
        CONFIG.filter = item;

        // now submit, as requested per #32
        $('form#search-form').submit()
      },

      // called any time there is text inside the input and it gets cleared (Backspace, Esc, Cancel button, etc).
      onCancel: function(node, event) {
        // clearing search serves as a reset
        hideSearchResults();           
        // if there is no event, then this was done programmatically (by setting search val to "")
        // and we shouldn't do anything else
        if (event) {
          prepareMapAndCharts();
          $("div.back").hide(); // hide the back button
        }
      }
    },
  });

  // typeahead search formatting
  $("form#search-form").on("submit", function(e) {
    e.preventDefault(); // don't actually submit, carry on below

    // Data filtering: search input
    // CONFIG.filter is populated when user clicks an item in the list
    // CONFIG.filter.display is the value, CONFIG.filter.group is the group
    if (CONFIG.filter) {
      var match = CONFIG.filter.display;
      var type = CONFIG.filter.group;
      switch (type) {
        case "Source Country": 
          prepareMapAndCharts({
            type: "source",
            targettype: "project",
            key: "source", 
            value: match, 
            view: "country", 
            rescale: "no"
          });
          break; 
        case "Recipient Country":
          prepareMapAndCharts({
            type: "target",
            targettype: "project",
            key: "country", 
            value: match, 
            view: "country", 
            rescale: "no"
          });
          break;
        case "Financier": 
          prepareMapAndCharts({
            type: "target",
            targettype: "project",
            key: "financer", 
            value: match, 
            view: "country", 
            rescale: "no"
          });
          break; 
        case "Project":
          prepareMapAndCharts({
            type: "target",
            targettype: "project",
            key: "target", 
            value: match, 
            view: "country", 
            rescale: "no"
          })
          break;
        default:
          console.log("Search type undefined, that shouldn't happen");
          prepareMapAndCharts();
      }

      // wrap up by clearing the filter, to set it back to the default state 
      CONFIG.filter = null;
    }
  });
}

// Set up the search terms. These are set once on the era filtered data, and refreshed whenever changing era filter, units filter or domestic filter (but not other filters and toggles)
function initSearchTerms() {
  // create a list of projects in the data format needed by the search input
  let projects = [...new Set(DATA.filtered.map(d => d.project_name))];
  let project_search = projects.map(function(d) {
    return {display: d}
  });

  // create a list of financers in the data format needed by the search input
  let financers = [...new Set(DATA.filtered.map(d => d.financer))];
  let financer_search = financers.map(function(d) {
    return {display: d}
  });

  // create a list of source countries, and then a list in the data format needed by the search input
  let sources = [...new Set(DATA.filtered.map(d => d.source))];
  let source_search = sources.map(function(d) {
    return {display: d}
  });

  // create a list of recipient countries, and then a list in the data format needed by the search input
  let targets = [...new Set(DATA.filtered.map(d => d.country))];
  let target_search = targets.map(function(d) {
    return {display: d}
  });

  // Setup the search data
  let search_data = {
    "Source Country": { data: source_search },
    "Recipient Country": { data: target_search },
    "Financier": { data: financer_search},
    "Project": { data: project_search},
    // TO DO: given time and data
    // "Generator": { data:},
    // "Turbine": {},
    // "Construction": {},
  };

  // init or refresh the data source for search
  // from https://github.com/running-coder/jquery-typeahead/issues/374
  CONFIG.search_input.options.source = search_data;
  CONFIG.search_input.unifySourceFormat();
  CONFIG.search_input.node.trigger('generate');

  hideSearchResults(); // hide the list of search results that shows inexplicably
}

// init selects and other search widgets, toggles etc. 
function initSelects() {
  // These first two filters (era and units) are "primary" filters, with slightly different behavior from the other selects

  // The finance era select
  $("select#era-select").select2({
    placeholder: "Select a status",
    minimumResultsForSearch: -1,
    dropdownCssClass: "era-type-select2"
  }).on("change", function() {
    // hide the "back" button if visible
    $("div.back").hide(); 

    // enable/disable the related close_year select
    if (this.value == 'closed') {
       $("select#close_year").prop("disabled", false);
     } else {
       $("select#close_year").val(null).trigger("change").prop("disabled", true);
     }

    // Prepare and draw everything 
    prepareMapAndCharts(); 

    // reinit the search terms after data is filtered
    initSearchTerms();
  });

  // The units select
  $("select#units-select").select2({
    placeholder: "Select units",
    minimumResultsForSearch: -1,
    dropdownCssClass: "units-type-select2"
  }).on("change", function() {
    // hide the "back" button if visible
    $("div.back").hide(); 

    // Prepare and draw everything 
    prepareMapAndCharts(); 

    // reinit the search terms after data is filtered
    initSearchTerms();
  });

  // The finance type select
  $("select#finance_type").select2({
    placeholder: "Select one or more types",
    minimumResultsForSearch: -1,
    dropdownCssClass: "units-type-select2"
  }).on("change", function() {
    // hide the "back" button if visible
    $("div.back").hide(); 

    // Prepare and draw everything 
    prepareMapAndCharts(); 

    // reinit the search terms after data is filtered
    initSearchTerms();
  });

  // The financer type select
  $("select#financer_type").select2({
    placeholder: "Select one or more types",
    dropdownCssClass: "financer-type-select2"
  }).on("change", function() {
    // Prepare and draw everything 
    prepareMapAndCharts({rescale: "no"}); 

    // reinit the search terms after data is filtered
    initSearchTerms();
  });

  // The year select ("close year")
  // first add years based on the current data
  let year_select = $("select#close_year");
  CONFIG.years.forEach(function(year) {
    if (!isNaN(year)) {
      $("<option>", {
        text: year,
        value: year,
      }).appendTo(year_select);
    }
  });
  year_select.select2({
    placeholder: "Select a year",
    minimumResultsForSearch: -1,
    dropdownCssClass: "close-year-select2",
    allowClear: true,
    disabled: true, // disabled by default, until era changes to "closed" (see above)
  }).on("change", function() {
    // Prepare and draw everything
    prepareMapAndCharts({rescale: "no"}); 

    // reinit the search terms after data is filtered
    initSearchTerms();
  });

  // The domestic/international filter
  $("select#domestic_international").select2({
    placeholder: "Select domestic or international",
    dropdownCssClass: "domestic-intl-select2",
    allowClear: true,
    minimumResultsForSearch: -1,
  }).on("change", function() {
    // Prepare and draw everything 
    prepareMapAndCharts({rescale: "no"}); 

    // reinit the search terms after data is filtered
    initSearchTerms();
  });
}

// various button and link inits
function initButtons() {
  // init the back button, essentially a "clear" or "home" type action
  // on the currently selected data (current/future)
  $("div#sidebar div.back").on("click", function() { 
    $("div.back").hide();                 // hide the back "button"
    prepareMapAndCharts();                // kick off a new map showing everything, with defaults
    $('input#search').val('');            // clear any value in the search input
  });

  // sidebar close and open buttons
  $('div#sidebar a.close').on("click", function(){
    $('div#sidebar').css({'left': -800});
  });

  // map hamburger to re-open sidebar
  $('div#sidebarHamburger').on("click", function(){
    $('div#sidebar').css({'left': 0});
  });

  // show/hide the chart
  $("div#chart-toggle span").on("click", function() {
    let button = $(this);
    if (button.data().state == "show") {
      $("div#chart").show();
    } else {
      $("div#chart").hide();
    }
    button.hide();
    button.siblings("span").show();
  });

  // show/hide the filters
  $("div#filter-toggle span").on("click", function() {
    let button = $(this);
    if (button.data().state == "show") {
      $("div#select-wrapper").show();
      $("div#filter-outer div#reset").show();
    } else {
      $("div#select-wrapper").hide();
      $("div#filter-outer div#reset").hide();
    }
    button.hide();
    button.siblings("span").show();
  });

  // minimize chart and filters on mobile
  // (note: chart does not show at all below 768px)
  if (isMobile()) {
    $("div#chart-toggle span[data-state='hide']").click();
    $("div#filter-toggle span[data-state='hide']").click();
  };

  // reset button below the filters
  $("div#reset span").on("click", function() {
    // reset all filters, with change namespaced to select2
    $("select#domestic_international").val("").trigger("change.select2");
    $("select#units-select").val("megawatts").trigger("change.select2");
    $("select#era-select").val("financing").trigger("change.select2");
    $("select#close_year").val("").trigger("change.select2");
    $("select#financer_type").val([]).trigger("change.select2");

    // reset the search input while we're at it
    $("input#search").val("");
    $("input#search").trigger("input.typeahead"); // or .trigger('propertychange.typeahead');
    hideSearchResults();

    // now kick off the data filtering and mapping
    setTimeout(function() {
      prepareMapAndCharts();
    }, 20);
  })

}

///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// NAMED FUNCTIONS 
///////////////////////////////////////////////////////////////////////////////////////////////////////////


// Primary rendering function to update the map, the pie chart, sidebar, et al.
// We filter the data at this step, given the current set of filters
function prepareMapAndCharts(args={}) {
  // set args and default args
  let view        = args.view || "global";         // global or single country view
  let type        = args.type || "source";         // source or target 
  let targettype  = args.targettype || "country";  // targettype: country or project
  let key         = args.key || null;              // the relevant field for the "search" in question: e.g. country, source, target, financer, project, financer_type, year etc. 
  let value       = args.value || null;            // the value (e.g. 1984) to match against the selected field/key (e.g. year)
  let rescale     = args.rescale || true;          // rescale the Sankey on the current data, or use flow min-max from an existing Sankey 

  // Data setup
  // the data we use is different for different views:
  // Global view gets country to country data
  // Country view get country to project data
  // Financer view gets country to project data
  // Project view gets country to project data
  let data;
  if (view == "global") {
    data = DATA.target_countries;
  } else {
    data = DATA.target_projects;
  }

  // Filtering setup
  // get the selected era from the checkbox at top right of the map and filter the data for it
  let era = $("select#era-select").val();

  // get the selected finance type from the dropdown
  let finance_type = $("select#finance_type").val();

  // get the selected institution type from the dropdown
  let financer_type = $("select#financer_type").val();

  // get the selected close year from the dropdown
  let close_year = $("select#close_year").val(); 

  // get the "domestic" search value from the domestic search input
  let domestic_intl = $("select#domestic_international").val();

  // get and set the units flag, see createLinks()
  CONFIG.units = $("select#units-select").val();
  
  // Filtering data: filter raw data by user selections for era, finance type and year
  // Country, financer, project and handled by key/value settings
  // Units is simply for display, not filtering
  DATA.filtered = data.filter(function(d) {
    // era filter
    if (d.era != era) return false;

    // finance type filter: multiple
    if (finance_type.length) {
      // if the current finance type doesn't match any of the selected, then pass
      if (finance_type.indexOf(d.finance_type) == -1) return false;
    };
    
    // institution type filter: multiple
    if (financer_type.length) {
      // if the current financer type doesn't match any of the selected, then pass
      if (financer_type.indexOf(d.financer_type) == -1) return false;
    };

    // close year: match a single year from user selection
    if (close_year && close_year != d.close_year) return false;

    // if denominating in Dollars, only collect rows with non-zero dollar amounts
    if (CONFIG.units == "dollars" && ! d.dollars) return false; 
    
    // if "domestic" search, then only return source == country
    // for "international" search, then only return source != country
    if (domestic_intl) {
      if (domestic_intl == "domestic" && d.source != d.country) return false;
      if (domestic_intl == "international" && d.source == d.country) return false;
    } 

    // secondary filter, based on an arbitrary key (field name in data.csv) and value pair
    // key can include country name, financer, project_name ...
    if (key && d[key] != value) return false;
    
    // If we got this far, then it's a match
    return true;
  });
  // warn the user if there was nothing selected
  if (! DATA.filtered.length) {
    // open a "Sweet Alert"
    swal("No data in selection!", "Please try a different set of filters", "error");
    return false;
  }

  // create the node features and link data needed for the spatial sankey 
  let links = createLinks();
  let nodes = createNodes(links);

  // Node and Flow Ranges: only calculate or recalulate these if requested
  if (rescale === true) {
    // calculate these ranges from the existing set of nodes and links
    CONFIG.node_flow_range = calcNodeFlowRange(nodes);
    CONFIG.link_flow_range = calcLinkFlowRange(links);
  }

  // always do this, so the SVG lines up with the map for this set of nodes/links
  updateZoomEnd();

  // Update content: 
  // Two primary view types, a global view (centroid to centroid), 
  // and a country view (centoid to project)
  if (view == 'global') {
    // Global View: centroid to centroid
    // Draw the map, charts, sidebar, etc.
    let fitmap = true;
    drawMap(nodes, links, "country", fitmap);
    drawLegend({source: "Financing Country", target: "Recipient Country"});
    drawGlobalSidebar(nodes);
    drawPieChart();
  } else {
    // Country view: centroid to project
    // Draw the map, charts, sidebar, etc.
    let fitmap = false;
    if (key == "country" || key == "financer" || key == "source") fitmap = true;
    drawMap(nodes, links, "project", fitmap);
    drawLegend({source: "Financiers", target: "Projects"});
    drawCountrySidebar({
      nodes: nodes, 
      view: view, 
      type: type,
      targettype: "project", 
      key: key, 
      value: value
    });
    drawPieChart();
    // console.log('targettype:', 'project');
    // console.log('view:', view);
    // console.log('type:', type);
    // console.log('key:', key);
    // console.log('value:', value);
  }

}

// get a single feature, given a matching name
function getSingleFeatureByCountryName(country) {
  var feature = CONFIG.spatialsankey.nodes().filter(function(d) {
    return d.id == country;
  });
  return feature[0];
}

// the main map drawing API, which takes in data and draws the nodes and links
function drawMap(nodes, links, targettype, fitmap=false) {    
  // add country outlines for this set of features
  var countries = nodes.map(function(c) {
    return c.country;
  });

  drawCountryBoundaries(countries);

  // Select and clear the svg element to work with
  var overlay_pane = d3.select("div#map").select("div.leaflet-overlay-pane")
  var svg = overlay_pane.select("svg");
  // this seems relevant to animation with data/enter/update/exit/remove ??
  svg.selectAll("*").remove();
  CONFIG.linklayer = svg.append("g");
  CONFIG.circlelayer = svg.append("g");

  // draw all map objects: links, source nodes, target nodes, legend  
  drawLinks(links, 'light');
  drawTargetCircles(nodes, CONFIG.targetcolor, targettype);
  drawSourceCircles(nodes, CONFIG.sourcecolor);

  // zoom to the extent of all features (all sources and targets)
  // currently, we only do this for "country" and "financer" clicks - where focus is on a single country or financer  
  if (fitmap) fitMapToFeatures(nodes);
}

// update two map lengends
// One with labels for source/targerts
// Another that indicates what the size of country circles indicates in terms of MW/$$
function drawLegend(args) {
  // Update source/Target legend:
  $('.country-legend-label.source').text(args.source);
  $('.country-legend-label.target').text(args.target);

  // Create circle legend: 
  // remove existing legend 
  d3.select("div#map").select("svg.legend").remove();

  // grab ahold of the biggest and smallest circle values
  let min = CONFIG.node_flow_range.min;
  let max = CONFIG.node_flow_range.max;

  var svg = d3.select("div#map")
    .append("svg")
      .attr("width", CONFIG.maxradius * 2 + 20)
      .attr("height", CONFIG.maxradius* 2 + 30)
      .classed("legend", true);

  var container = svg.append("g")
      .attr("transform",`translate(${CONFIG.maxradius + 10},${CONFIG.maxradius + 20})`);

  // add the circles
  // first the max circle, and label
  container
    .append("circle")
      .attr("stroke", "#777")
      .attr("fill", "white")
      .attr("fill-opacity", "0.28")
      .attr("r", CONFIG.maxradius);

    svg
      .append("text")
      .attr("x", "50%")
      .attr("y", "10")
      .attr("dominant-baseline","middle") 
      .attr("text-anchor","middle")
      .text(CONFIG.format[CONFIG.units](max))
      .attr("fill", "#777");

  // append the "min" circle and label  
  container
    .append("circle")
      .attr("stroke", "#777")
      .attr("fill", "white")
      // half the big circle opacity, so they appear to be the same "color"
      .attr("fill-opacity", "0.14")
    .attr("cy", `${CONFIG.maxradius - 10}`)
    .attr("r", CONFIG.minradius);

    svg
      .append("text")
      .attr("x", "50%")
      .attr("y", "60%")
      .attr("dominant-baseline","middle") 
      .attr("text-anchor","middle")
      .text(CONFIG.format[CONFIG.units](min))
      .attr("fill", "#777");
}

// draw a pie chart showing Financer Type breakdown for the current set of filtered data
function drawPieChart() {
  let config = {
    chart: {
      plotBackgroundColor: null,
      plotBorderWidth: null,
      plotShadow: false,
      type: 'pie',
      spacing: [10,5,5,5], // default is [10,10,15,10]
    },
    legend: {
      itemStyle: {
        textOverflow: null,
        fontFamily: "Open Sans"
      },
      style: {
        fontSize: "13px",
      },

    },
    title: {
      text: `Percent ${CONFIG.units == "megawatts" ? "Capacity" : "Funding"} by Institution Type`,
      margin: 10,
      style: {
        fontSize: "13px",
        fontFamily: "Open Sans"
      }
    },
    tooltip: {
      pointFormat: "{series.name}: <b>{point.percentage:.1f}%</b>"
    },
    accessibility: {
      point: {
        valueSuffix: "%"
      }
    },
    plotOptions: {
      pie: {
        allowPointSelect: true,
        cursor: "pointer",
        dataLabels: {
          enabled: false,
        },
        showInLegend: true,
      }
    },
    series: [{
      name: "Percent",
      colorByPoint: true,
      size: '120%',
      innerSize: '40%',
    }]
  }

  // get the data in the format HC needs
  let financers = uniqueByKey(DATA.filtered, "financer_type");
  let output = []; 
  let total = DATA.filtered.reduce((total, item) => item[CONFIG.units] + total, 0);
  financers.forEach(function(f) {
    let sum = 0; 
    DATA.filtered.forEach(function(item) {
      if (item.financer_type == f) {
        sum += item[CONFIG.units];
      }
    });
    let percent = ( sum / total ) * 100;

    let result = {
      name: f,
      y: percent,
      color: CONFIG.piechart_colors[f],
    }
    output.push(result);
  });
  // add the data to the series
  config.series[0].data = output;

  // debugger;

  // render the chart
  Highcharts.chart('chart', config); 
}


// given an array of country names, add country boundaries to the map
function drawCountryBoundaries(countries, zoomto=false) {
  // first clear existing layers
  CONFIG.country_layers.clearLayers();
  // now add the new set
  var country_layer = L.geoJSON(DATA.country_data, {
    pane: "country-outline", 
    style: CONFIG.country_style,
    interactive: false, // no click functionality, see #23
    filter: function(feature) {
      if (countries.indexOf(feature.properties.NAME) > -1) return true;
    }
  }).addTo(CONFIG.country_layers);

  // optionally, zoom the map to fitBounds on the result
  if (zoomto) CONFIG.map.fitBoundsWithOffset(country_layer.getBounds());
}

// hack. Something somewhere causes the search dropdown result list to open onClear, etc., each time we renew the search terms
// so use a background click to hide it. It will show again when needed
function hideSearchResults() {
  setTimeout(function() {
    $("body").click(); 
  }, 50);
}

// // Clear the search input when changing filters
// function clearSearchInput() {
//   $("input#search").val("");
//   $("input#search").trigger("input.typeahead"); // or .trigger('propertychange.typeahead');
//   hideSearchResults();
// }

///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// SIDEBAR RELATED FUNCTIONS 
///////////////////////////////////////////////////////////////////////////////////////////////////////////

// update the sidebar results from the current Spatial Sankey
function drawGlobalSidebar(nodes) {
  // hide the other sidebars, and show this one
  $("div#sidebar div.sidebar").hide();
  $("div#sidebar div#global-content").show();

  /*
   * GLOBAL SIDEBAR TOP SECTION: OUTFLOWS
   */
  // For the top section, sum and sort outflows
  // beware: some countries have both inflows and outflows, and we have to account for that, so they don't get listed twice
  var country_list = [];
  var outflows = nodes.reduce(function(result, feature) {
    // only grab countries with an outflow
    if (feature.properties.aggregate_outflows) {
      // only continue if we haven't encountered this country
      if (country_list.indexOf(feature.id) == -1) {
        // not a duplicate, add it to the result, and add an entry to the list of countries to check
        result.push({
          key: "country",
          value: feature.id, 
          flow: feature.properties.aggregate_outflows, 
          type: "source", 
        });
        country_list.push(feature.id); 
      }
    }
    return result;
  }, []);

  // sort the result
  var sorted = _.orderBy(outflows, ['flow'],['desc']);
  // create the rows
  var outflow_rows = d3.select("div#global-content div.source-panel div.results").selectAll("div.row")
    .data(sorted);

  // use the first value from sorted to set up the barscale, to size the bar widths, below
  // keep track of max flow value (so far) for the barscale (see below)
  var max = sorted[0].flow;

  // Add chart rows for each outflow
  // update
  outflow_rows.classed("row", true);
  // append new ones
  outflow_rows.enter()
    .append("div")
    .classed("row", true);
  // exit
  outflow_rows.exit()
    .remove();

  /*
   * GLOBAL SIDEBAR BOTTOM SECTION: INFLOWS
   */
  // For the bottom section, sum and sort inflows
  var country_list = [];
  var inflows = nodes.reduce(function(result, feature) {
    // only grab countries with an inflow
    if (feature.properties.aggregate_inflows) { 
      // only continue if we haven't encountered this country
      if (country_list.indexOf(feature.id) == -1) {
        // not a duplicate, add it to the result, and add an entry to the list of countries to check
        result.push({
          key: "country",
          value: feature.id, 
          flow: feature.properties.aggregate_inflows, 
          type: "target", 
        });
        country_list.push(feature.id); 
      }
    }
    return result;
  }, []);

  // sort the result
  var sorted = _.orderBy(inflows, ["flow"],["desc"]);
  // create the rows
  var inflow_rows = d3.select("div#global-content div.target-panel div.results").selectAll("div.row")
    .data(sorted);

  /*
   * GLOBAL SIDEBAR TOP AND BOTTOM SECTION: Construct chart rows
   */
  // update
  inflow_rows.classed("row", true);
  // enter new ones
  inflow_rows.enter()
    .append("div")
    .classed("row", true);
  // exit
  inflow_rows.exit()
    .remove();

  // use the max value from the two sorts to set up the barscale, to size the bar widths, below
  var max = sorted[0].flow > max ? sorted[0].flow : max;
  var barscale = CONFIG.barscale(max);

  // sub-elements for all rows: first a wrapper div
  d3.selectAll("div.chartrow").remove();
  var chartrow = d3.selectAll("div.row").selectAll("div.chartrow")
    .data(function(d) {return [d]})
    .enter()
    .append("div")
    .classed("chartrow", true)
    .attr("title", "Click for additional details")
    .attr("data-type", function(d) {return d.type})
    .attr("data-value", function(d) {return d.value})
    .attr("data-key", function(d) { return d.type == "source" ? "source" : "country"})
    .on("click", function(d) {
      // get the clicked country
      var item = d3.select(this).node();
      var value = item.dataset.value;
      var type = item.dataset.type;
      var key = item.dataset.key;
      // source or target country search, depending on the type of bar clicked
      prepareMapAndCharts({
        view: "country",
        key: key,
        value: value, 
        type: type,
        targettype: "project",
        rescale: "no"
      });
    });
  
  // now append siblings to the wrapper div: 
  // the bar itself
  chartrow.append("div")
    .attr("class", function(d) { return d.type })
    .classed("bar", true);

  d3.selectAll("div.bar")
    // transition may not show on initial load because not on page? 
    .transition()
    .duration(1000)
    .style("width", function(d) { return barscale(d.flow) + "px" });
  
  // a units label for the bar
  chartrow.append("div")
    .classed("units-label", true)
    .text(function(d) { return CONFIG.format[CONFIG.units](d.flow) });

  // and a name below each bar
  chartrow
    .append("div")
    .classed("name-label", true)
    .text(function(d) { return d.value });

}

// Draw function for a single country sidebar, either source or target
function drawCountrySidebar(args) {
  // get or set args
  let view        = args.view;
  let type        = args.type;
  let targettype  = args.targettype;
  let key         = args.key;
  let value       = args.value;
  let nodes       = args.nodes;

  // hide the other sidebars, and show this one
  $("div#sidebar div.sidebar").hide();
  $("div#sidebar div#country-content").show();

  // Reset the label in the Projects section to simply read "Projects" again
  $("div.projects h3 #institution-name").text("");

  // show the back "button"
  $("div.back").show();

  // Set the background color for the title in the sidebar
  let bgcolor = type == "source" ? CONFIG.sourcecolor : CONFIG.targetcolor;
  let bgcolor_light = type == "source" ? CONFIG.sourcecolor_light : CONFIG.targetcolor_light;
  $("div#sidebar div#country-content div.title-wrapper").css({background: bgcolor_light}); 
  $("div#sidebar div#country-content div.country-title").css({background: bgcolor}); 

  // Update the country or project name at the top of the title bar
  $("div#sidebar div.country-title div.name").text(value);
  
  // Update the label below the country or project name
  var text = "Financing Country";
  if (type == "target") text = "Recipient Country";
  if (key == "financer") text = "Financier";
  if (key == "target" && targettype == "project") text = "Recipient Project";
  $("div#sidebar div.country-label").text(text);

  // Set panel heights: This has to be dynamic, as the header with the title can be one or multiple lines, depending on the value
  let title_height = $("div#country-content div.title-wrapper").height();
  let window_height = $(window).height();
  let panel_height = (window_height - title_height) / 2;
  $("div#country-content div.results").height(panel_height - 50);

  /*
   * COUNTRY SIDEBAR TOP SECTION: OUTFLOWS
   */
  // For the top section, for this country, get all contributions by financer and project
  // We can't use the Sankey directly (at least not easily) as we want to show individual financers, not countries
  let filtered = DATA.filtered.reduce(function(result, row) {
    if (row[key] == value) { 
      result.push({
        financer: row.financer, 
        unit: row.unit,
        name_unit_concat: row.financer + "##" + row.unit, 
        project: row.project_name, 
        units: row[CONFIG.units], 
        type: type});
    }
    return result;
  }, []);

  // first, get the mean flow by _unique_ financer/unit we created above
  // taking the mean takes care of duplicate rows in the groupBy 
  let financers_units = _(filtered)
      .groupBy("name_unit_concat")
      .map((objs, key) => ({
        "name": objs[0].financer,
        "type": type,
        "flow": _.meanBy(objs, "units"), 
      }))
      .value();

  // then a second groupBy of that, to get the sum at the level of the financer
  var financers = _(financers_units)
      .groupBy("name")
      .map((objs, item) => ({
        "value": item,
        "type": type,
        "key": "financer",
        "flow": _.sumBy(objs, "flow"), 
      }))
      .value();

  // sort the result, and add the sorted data to a selection
  var sorted = _.orderBy(financers, ["flow"],["desc"]);
  var financer_rows = d3.select("div#country-content div.institutions div.results").selectAll("div.row")
    .data(sorted);

  // keep track of the max value (so far), see below
  var max = sorted[0].flow;

  // Add chart rows for each Country
  // update
  financer_rows.classed("row", true);
  // append new ones
  financer_rows.enter()
    .append("div")
    .classed("row", true);
  // exit
  financer_rows.exit()
    .remove();

  /*
   * COUNTRY SIDEBAR BOTTOM SECTION: INFLOWS
   */
  // For the bottom section, sum and sort inflows
  // Here, inflows for the chart can be calculated directly from the Sankey nodes
  var country_list = [];
  var inflows = nodes.reduce(function(result, feature) {
    // only grab countries with an inflow
    if (feature.properties.aggregate_inflows) { 
      // only continue if we haven't encountered this country
      if (country_list.indexOf(feature.id) == -1) {
        // not a duplicate, add it to the result, and add an entry to the list of countries to check
        result.push({
          key: "target", // in project data, target is project_name
          value: feature.id, 
          flow: feature.properties.aggregate_inflows, 
          type: "target",
          targettype: targettype,
        });
        country_list.push(feature.id); 
      }
    }
    return result;
  }, []);

  // sort the result, and add the sorted data to a selection
  var sorted = _.orderBy(inflows, ["flow"],["desc"]);
  var project_rows = d3.select("div#country-content div.projects div.results").selectAll("div.row")
    .data(sorted);

  /* 
   * COUNTRY SIDEBAR: CONSTRUCT ALL CHART ROWS, TOP AND BOTTOM
   */
  // Add chart rows for each Project
  // update
  project_rows.classed("row", true);
  // enter new ones
  project_rows.enter()
    .append("div")
    .classed("row", true);
  // exit
  project_rows.exit()
    .remove();

  // use the first value from sorted to set up the barscale, to size the bar widths, below
  var max = sorted[0].flow > max ? sorted[0].flow : max;
  var barscale = CONFIG.barscale(max);

  // sub-elements for all rows: first a wrapper div
  d3.selectAll("div.chartrow").remove();
  var chartrow = d3.selectAll("div.row").selectAll("div.chartrow")
    .data(function(d) {return [d]})
    .enter()
    .append("div")
    .classed("chartrow", true)
    .attr("data-type", function(d) {return d.type})
    .attr("data-targettype", function(d) {return d.targettype})
    .attr("data-key", function(d) {return d.key})
    .attr("data-value", function(d) {return d.value})
    .attr("title", "Click for additional details")
    .on("click", function(d) {
      // get the clicked item
      let item = d3.select(this).node();
      let key = item.dataset.key;
      let value = item.dataset.value;
      let type = item.dataset.type;
      let targettype = item.dataset.targettype;
      
      // financer or project search, depending on the bar clicked
      prepareMapAndCharts({
        view: "country", 
        key: key, 
        value: value, 
        type: type,
        targettype: targettype,
        rescale: "no"
      });
    });

  // now append siblings to the wrapper div: 
  // the bar itself
  chartrow.append("div")
    .attr("class", function(d) {return d.type})
    .classed("cancelled", function(d) { return d.flow == 0 })
    .classed("bar", true);

  d3.selectAll("div.bar")
    // may not show on initial load because not on page? 
    .transition()
    .duration(1000)
    .style("width", function(d) { 
      let width = d.flow == 0 ? "0px" : barscale(d.flow) + "px";
      return width;
    });
  
  // a units label for the bar
  chartrow.append("div")
    .classed("units-label", true)
    .classed("cancelled", function(d) { return d.flow == 0 })
    .text(function(d) { return CONFIG.format[CONFIG.units](d.flow) });

  // and a name below each bar
  chartrow
    .append("div")
    .classed("name-label", true)
    .text(function(d) { return d.value });

  // additional content for a single project view: Add Units
  $("div#country-content div.projects div.results div#units-wrapper").remove();
  if (key == "target" && targettype == "project") {
    let target = $("div#country-content div.projects div.results");
    let wrapper = $("<div>", { id: "units-wrapper" }).appendTo(target);
    $("<h5>", {text: "Units"}).appendTo(wrapper);
  
    // get the unique set of units
    let units = uniqueByKey(DATA.filtered, "unit");
    let units_financers = [];
    // Unit markup and other details TBD
    units.forEach(function(unit) {
      let details = { key: unit, values: [] };
      let filtered = DATA.filtered.filter(function(z) { return z.unit == unit });
      details.wiki = filtered[0].wiki; // okay to grab the first, wiki page is the same for each unit row
      details.flow = CONFIG.format[CONFIG.units](filtered[0][CONFIG.units]); // okay to grab the first, flow will be the same for each unit row
      filtered.forEach(function(d) {
        details.values.push(`${d.financer} (${CONFIG.format[CONFIG.units](d[CONFIG.units])})`);
      });
      units_financers.push(details);
    });

    units.forEach(function(unit) {
      units_financers.forEach(function(e) {
        if (e.key == unit) {
          let outer = $("<div>", {html: `<a href=${e.wiki} target="_blank">${unit} (${e.flow})&nbsp;<i class="fas fa-external-link-alt"></i></a>`, class: 'unit-details'}).appendTo(wrapper);
          let html = e.values.join(", ");
          $("<div>", {
            html: html,
          }).appendTo(outer);
        }
      })
    });

  }


}

///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// SANKEY RELATED FUNCTIONS 
///////////////////////////////////////////////////////////////////////////////////////////////////////////

// derive a set of links from the filtered data
// a link shows a source country, a target country or project, and a sum or "flow" between the two
// target type is either country or project
function createLinks() {
  // set up the output
  var links = [];

  // get a unique list of sources
  var sources = uniqueByKey(DATA.filtered, "source");
  sources.forEach(function(source) {
    // get a list of source rows that match this source, from the incoming data
    var source_data = DATA.filtered.filter(function(d) {return d.source == source});
    // get a list of targets for this one country or financer
    var targets = uniqueByKey(source_data, "target");
    // keep a list of projects, to avoid double counting MW for duplicate project rows
    var units = [];
    targets.forEach(function(target) {
      // get all the unit rows from the source country to the target country or project
      let source_target_data = source_data.filter(function(c) { return c.target == target });
      
      var total_flow = 0;
      source_target_data.forEach(function(e) {
        // if we are accounting in MW, _and_ we already encountered this unit, then skip it
        // for MW, we only count projects one time
        if (CONFIG.units == "megawatts" && units.indexOf(e.unit) > -1) return; 
        units.push(e.unit);
        total_flow += e[CONFIG.units];
      });

      // now construct the link. Because e.source and e.target are the same for every object in source_target_data, 
      // just grab the first one 
      var datum = source_target_data[0];
      var link = {
        source: datum.source,
        target: datum.target,
        flow: total_flow,
        target_country: datum.country,
        source_coords: [parseFloat(datum.source_lat), parseFloat(datum.source_lng)],
        target_coords: [parseFloat(datum.target_lat), parseFloat(datum.target_lng)]
      }

      // all set! add it to the list
      links.push(link);
    });
  });  
  // all set!
  return links;
}

// create the unique set of GeoJSON features needed for d3.spatialsankey()
// targets can be country centroids or project locations, depending on the view
function createNodes(links) {
  // set up the output 
  const nodes = [];
  // for removing duplicates - we only need one feature for each source, and one for each target
  const source_countries = [];
  const target_locations = [];

  // Go over each link and do the following
  // 1. create a source node (if one not already present)
  // 2. calculate aggregate inflows and outflows for the source node, and save these as properties
  // 3. create a target node (if one not already present)
  // 4. calculate aggregate inflows and outflows for the target node, and save these as properties
  // Q: Why can't we just use the flow calculated on the link? Because using flows directly will double count project MW coming from multiple sources to the same project/unit
  links.forEach(function(link) {
    // SOURCES: always a country centroid
    let source = link.source; 
    if (source_countries.indexOf(source) == -1) {
      // set up the feature
      let feature = createNodeFeature(link, "source");
    
      // get the set of all rows for this source, and sum flow for project units
      // the method for summing is different for MW and $$: 
      // - MW repeat across rows of units with the same name, but we only count them once (get distinct units then sum MW)
      // - $$ is a simple sum
      let units = [];
      let total_flow = 0;
      let country_data = DATA.filtered.filter(function(d) { return d.source == source });
      country_data.forEach(function(d) {
        if (CONFIG.units == "megawatts" && units.indexOf(d.unit) > -1) return; 
        units.push(d.unit); // track that we've recorded this one
        total_flow += d[CONFIG.units];
      });

      // stamp the feature with this total flow, and push it to the collection of nodes
      feature.properties.aggregate_outflows = total_flow;
      feature.properties.flow = total_flow; // keep a copy for calculating global min/max flow

      nodes.push(feature);
      source_countries.push(source); // note that we're done with this one 
    }

    // TARGETS: can be a country centroid, or a project location
    let target = link.target;
    if (target_locations.indexOf(target) == -1) {
      // set up the feature
      let feature = createNodeFeature(link, "target");

      // get the set of all rows for this target, and sum flow for unique project units
      // the method for summing is different for MW and $$: 
      // - MW repeat across rows of units with the same name, but we only count them once (get distinct units then sum MW)
      // - $$ is a simple sum
      let units = [];
      let total_flow = 0;
      let country_data = DATA.filtered.filter(function(d) { return d.target == target });

      country_data.forEach(function(d) {
        if (CONFIG.units == "megawatts" && units.indexOf(d.unit) > -1) return; 
        units.push(d.unit); // track that we've recorded this one
        total_flow += d[CONFIG.units];
      });

      // stamp the feature with this total flow
      feature.properties.aggregate_inflows = total_flow;
      feature.properties.flow = total_flow; // keep a copy for calculating global min/max flow

      nodes.push(feature);
      target_locations.push(target); // note that we're done with this one
    }
  })
  // all set
  return nodes;
}

// utility function that returns a geojson feature for a "node"
function createNodeFeature(d, type) {
  let countryfield;
  let coordsfield = type == "source" ? "source_coords" : "target_coords";
  let lat, lng;
  if (type == "source") {
    lat = d.source_coords[0];
    lng = d.source_coords[1];
    countryfield = "source";
  } else {
    lat = d.target_coords[0];
    lng = d.target_coords[1];
    countryfield = "target_country";
  }

  // create the feature
  let feature = {
    type: "Feature",
    id: d[type],
    country: d[countryfield], 
    properties: {
      "LAT": lat,
      "LON": lng,
      "circletype": type,
    },
    geometry: {
      type: "Point",
      coordinates: [lng, lat]
    }
  };
  return feature;
}

// get min and max from the current set of node flow ranges
function calcNodeFlowRange(nodes) {
  // get the global min flow value, regardless of inflow/outflow
  let min = d3.min(nodes, function(node) { return node.properties.flow; });
  // get the global max flow value, regardless of inflow/outflow
  let max = d3.max(nodes, function(node) { return node.properties.flow; });
  // if min == max, then we don't know how to scale the nodes
  // this is a crude fix, but in that case, just add "1" to max
  if (min == max) max = min + 1;
  // all set
  return {min: min, max: max};
}

// get min and max for link flow ranges
function calcLinkFlowRange(links) {
  // get the global min and max flow from the current set of links
  let min = d3.min(links, function(link) { return link.flow; });
  let max = d3.max(links, function(link) { return link.flow; });
  // all set 
  return {min: min, max: max};
}

// Draw source circles
function drawSourceCircles(nodes, color) {
  // filter to source nodes only
  nodes = nodes.filter(function(n) { return n.properties.circletype == "source" });

  // Select source circles and join data to the selection
  let circs = CONFIG.circlelayer.selectAll("circle.source")
    .data(nodes);
 
  // Exit selection: remove circles left over
  circs.exit().remove();

  // Enter: Add new circles, with the given class
  let circs_enter = circs.enter()
    .append("circle")
    .attr("data-current-inflow", function(d) { return d.current_inflow })
    .attr("data-inflow", function(d) { return d.properties.aggregate_inflows })
    .attr("data-outflow", function(d) { return d.properties.aggregate_outflows })
    .attr("data-country", function(d) { return d.id })
    .attr("class", "source")
    .attr("cx", CONFIG.calc_node_cx)
    .attr("cy", CONFIG.calc_node_cy)
    .attr("r", CONFIG.calc_node_r_outflows)
    .style("fill", color)
    .attr("opacity", 1)
    .on("click", function(d) {
      // source country search
      prepareMapAndCharts({
        view: "country", 
        key: "source", 
        value: d.id, 
        type: "source",
        targettype: "project", 
        rescale: "no"
      });
    });

  // Update: update existing circles
  circs
    .attr("data-current-inflow", function(d) { return d.current_inflow })
    .attr("data-inflow", function(d) { return d.properties.aggregate_inflows })
    .attr("data-outflow", function(d) { return d.properties.aggregate_outflows })
    .attr("data-country", function(d) { return d.id })
    .attr("class", "source")
    .attr("cx", CONFIG.calc_node_cx)
    .attr("cy", CONFIG.calc_node_cy)
    .attr("r", CONFIG.calc_node_r_outflows)     
    .style("fill", color);

  // update the tooltip, but only if _not_ mobile
  if (!isMobile()) {
    // select them again, goofy, I know, but we want to get both the enter() and update sets
    let current_source_circs = CONFIG.circlelayer.selectAll("circle.source")
      .on("mouseover", function(d) {
        let text = `Financing Country: ${d.id}`;
        text += "<br>";
        text += CONFIG.units == "megawatts" ? "Capacity: " : "Funding: ";
        text += CONFIG.format[CONFIG.units](d.properties.aggregate_outflows);
        CONFIG.tooltip.html(text);
        CONFIG.tooltip.style("visibility", "visible");
        return;
      })
      .on("mousemove", function(d) {
        return CONFIG.tooltip.style("top",
        (d3.event.pageY-10)+"px").style("left",(d3.event.pageX+10)+"px");
      })
      .on("mouseout", function(d){
        return CONFIG.tooltip.style("visibility", "hidden");
      });
  }
}

// Draw target circles
function drawTargetCircles(targetnodes, color, targettype) {
  // filter to target nodes only
  targetnodes = targetnodes.filter(function(n) { return n.properties.circletype == "target" });

  // select target elements and bind the data
  let targetcircs = CONFIG.circlelayer.selectAll("circle.target")
    .data(targetnodes);

  // exit condition
  targetcircs.exit().remove();

  // create new circles, with the given class
  let targetcircs_enter = targetcircs.enter()
    .append("circle")
    .attr("class","target")
    .attr("data-current-inflow", function(d) { return d.current_inflow })
    .attr("data-inflow", function(d) { return d.properties.aggregate_inflows })
    .attr("data-outflow", function(d) { return d.properties.aggregate_outflows })
    .attr("data-country", function(d) { return d.id })
    .attr("cx", CONFIG.calc_node_cx)
    .attr("cy", CONFIG.calc_node_cy)
    .attr("r", CONFIG.calc_node_r_inflows)
    .style("fill", color)
    .attr("opacity", 1)
    .on("click", function(d) { 
      // target country search
      let key = targettype == "project" ? "target" : "country";
      prepareMapAndCharts({
        view: "country", 
        key: key, 
        value: d.id, 
        type: "target",
        targettype: targettype,
        rescale: "no"
      });
    });

  // update existing ones 
  targetcircs
    .attr("data-current-inflow", function(d) { return d.current_inflow })
    .attr("data-inflow", function(d) { return d.properties.aggregate_inflows })
    .attr("data-outflow", function(d) { return d.properties.aggregate_outflows })
    .attr("data-country", function(d) { return d.id })
    .attr("class","target")
    .attr("cx", CONFIG.calc_node_cx)
    .attr("cy", CONFIG.calc_node_cy)
    .attr("r", CONFIG.calc_node_r_inflows)   
    .style("fill", color);

  // update the tooltip, but only if _not_ mobile
  if (!isMobile()) {
    // select them again, goofy, I know
    let current_target_circs = CONFIG.circlelayer.selectAll("circle.target")
      .on("mouseover", function(d) { 
        let text = `Recipient ${targettype}: ${d.id}`;
        text += "<br>";
        text += CONFIG.units == "megawatts" ? "Capacity: " : "Funding: ";
        text += CONFIG.format[CONFIG.units](d.properties.aggregate_inflows);

        CONFIG.tooltip.html(text);
        CONFIG.tooltip.style("visibility", "visible");
        return;
      })
      .on("mousemove", function(d){
        return CONFIG.tooltip.style("top",
        (d3.event.pageY-10)+"px").style("left",(d3.event.pageX+10)+"px");
      })
      .on("mouseout", function(d){
        return CONFIG.tooltip.style("visibility", "hidden");
      });
  }
}

// draw the links between nodes
function drawLinks(links, addclass=null) {
  // Add data to link layer
  var beziers = CONFIG.linklayer.selectAll("path")
    .data(links);
  
  // if specified, add a second class to the link paths
  // expected use is to draw very light links on first load only
  var klasses = addclass ? `link ${addclass}` : "link";

  // Draw the links
  // update the existing ones
  beziers
    .attr("class", klasses)
    .attr("d", CONFIG.calc_link_path)
    .style("stroke-width", CONFIG.link_width_function);
    
  // append new ones 
  var beziers_enter = beziers.enter()
    .append("path")
    // need this for hover events
    .attr("pointer-events", "visibleStroke")
    .attr("class", klasses)
    .attr("d", CONFIG.calc_link_path)
    .attr("id", function(d){ return d.id })
    .style("stroke-width", CONFIG.link_width_function);

  // update the tooltip, but only if _not_ mobile
  if (!isMobile()) {
    // CONFIG.tooltip
    beziers_enter
      .on("mouseover", function(d) {
        let text = `From ${d.source} to ${d.target}`;
        text += "<br>";
        text += CONFIG.format[CONFIG.units](d.flow);
        CONFIG.tooltip.html(text);
        CONFIG.tooltip.style("visibility", "visible");
        return;
      })
      .on("mousemove", function(d){
        return CONFIG.tooltip.style("top",
        (d3.event.pageY-10)+"px").style("left",(d3.event.pageX+10)+"px");
      })
      .on("mouseout", function(d){
        return CONFIG.tooltip.style("visibility", "hidden");
      });
  }

  // Remove old links
  beziers.exit().remove();
}

// fit the map to a given set of features
function fitMapToFeatures(features, reverse_coords=false) {
  var geojson = {
    "type": "FeatureCollection",
    "features":[],
  };
  features.forEach(function(feature) {
    geojson.features.push(feature);
  });

  // the spatialsankey nodes object carries the features, and reverses these in place
  // hence we have to reverse them back to get proper bounds
  var layer = L.geoJson(geojson);
  var bounds = layer.getBounds();

  if (reverse_coords) {
    var ne = bounds.getNorthEast();
    var sw = bounds.getSouthWest();
    bounds = [[ne.lng, ne.lat],[sw.lng, sw.lat]];
  }
  CONFIG.map.fitBoundsWithOffset(bounds);
}

// On Leaflet zoomend, make sure cx and cy are in sync with the map
function updateZoomEnd() {
  CONFIG.map.on("zoomend", function() {
    // Update links position
    CONFIG.linklayer.selectAll("path").attr("d", CONFIG.calc_link_path);

    // Update source circles
    // why does reselecting these make a difference? 
    var circs = CONFIG.circlelayer.selectAll("circle.source");
    circs
      .attr("cx", CONFIG.calc_node_cx)
      .attr("cy", CONFIG.calc_node_cy); 

    // Update target circles
    // why does reselecting these make a difference? 
    var targetcircs = CONFIG.circlelayer.selectAll("circle.target");
    if (targetcircs.nodes().length > 0) {
      targetcircs
        .attr("cx", CONFIG.calc_node_cx)
        .attr("cy", CONFIG.calc_node_cy); 
    } 
  });
};

///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// SHIMS AND UTILITIES: Various polyfills to add functionality
///////////////////////////////////////////////////////////////////////////////////////////////////////////
// trim() function
if(!String.prototype.trim) { String.prototype.trim = function () {return this.replace(/^\s+|\s+$/g,'');};}

// get an object's keys
Object.keys||(Object.keys=function(){'use strict';var t=Object.prototype.hasOwnProperty,r=!{toString:null}.propertyIsEnumerable('toString'),e=['toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','constructor'],o=e.length;return function(n){if('object'!=typeof n&&('function'!=typeof n||null===n))throw new TypeError('Object.keys called on non-object');var c,l,p=[];for(c in n)t.call(n,c)&&p.push(c);if(r)for(l=0;o>l;l++)t.call(n,e[l])&&p.push(e[l]);return p}}());

// string Capitalize first letter
String.prototype.capitalize = function() { return this.charAt(0).toUpperCase() + this.slice(1);}

// get a string's Proper Case
String.prototype.toTitleCase=function(){var e,r,t,o,n;for(t=this.replace(/([^\W_]+[^\s-]*) */g,function(e){return e.charAt(0).toUpperCase()+e.substr(1).toLowerCase()}),o=['A','An','The','And','But','Or','For','Nor','As','At','By','For','From','In','Into','Near','Of','On','Onto','To','With'],e=0,r=o.length;r>e;e++)t=t.replace(new RegExp('\\s'+o[e]+'\\s','g'),function(e){return e.toLowerCase()});for(n=['Id','Tv'],e=0,r=n.length;r>e;e++)t=t.replace(new RegExp('\\b'+n[e]+'\\b','g'),n[e].toUpperCase());return t};

// reduce arrays to unique items
const uniq = (a) => { return Array.from(new Set(a));}

// variable to show if we are are on a mobile or iPad client
var mobileDetect = new MobileDetect(window.navigator.userAgent);
function isMobile() { return mobileDetect.mobile(); }

// wait for a variable to exist. When it does, fire the given callback
function waitForIt(key, callback) {
  if (key) {
    callback();
  } else {
    setTimeout(function() {
      waitForIt(key, callback);
    }, 100);
  }
};

// slice array into even chunks
function chunkArray(arr, len) {
  var chunks = [], i = 0, n = arr.length;
  while (i < n) {
    chunks.push(arr.slice(i, i += len));
  }
  return chunks;
}

// reduce object to unique array of items by key
const uniqueByKey = function(array, key) {
  var unique = {};
  var distinct = [];
  for (var i in array) {
    if (typeof(unique[array[i][key]]) == "undefined"){
      distinct.push(array[i][key]);
    }
    unique[array[i][key]] = 0;
  }
  return distinct;
}