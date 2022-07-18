"use strict";

var patientData = {};
var activePatient = {};
var observationData = {};
var refreshTimeout = false;
// var assessments = [];

$( window ).load(function() {
  PopulatePatientData();
});

function PopulatePatientData () {
  $.get("https://fhir.openice.info/fhir/Patient?_count=100", function( data ) {
  // $.get("http://fhirtest.uhn.ca/baseDstu2/Patient?active=true&_count=500", function( data ) {

    if (data.entry && data.entry.length > 0) {
      for(var i = 0; i < data.entry.length; i++) {
        var pt = data.entry[i].resource;
        // Require given and family name
        if (pt.name && pt.name.length > 0 && pt.name[0].given && pt.name[0].given.length > 0
              && pt.name[0].family && pt.name[0].family.length > 0) {
          patientData[data.entry[i].resource.id] = data.entry[i].resource;

          if (pt.birthDate) {
            patientData[data.entry[i].resource.id].age = moment().diff(pt.birthDate, 'years');
          }

          if (pt.gender) {
            switch (patientData[data.entry[i].resource.id].gender) {
              case 'male' || 'Male' || 'MALE' || 'M' || 'm' :
                patientData[data.entry[i].resource.id].genderShort = 'M';
                break;
              case 'female' || 'Female' || 'FEMALE' || 'F' || 'f' :
                patientData[data.entry[i].resource.id].genderShort = 'F';
                break;
              default:
                console.log('Invalid gender format on pt', pt.id);
            }
          }
        } else {
          console.log('Patient data omitted from list due to missing name value. PID: ', pt.id ? pt.id : '')
        }
      }
    } else {
      console.log('FHIR query to fhir.openice.info/Patient returned no data.');
    }
  }).fail(function () {
    jQuery('<p/>', { 'class': 'mrs-patient-list-none' }).html('Sorry, something has gone wrong with our FHIR server.').appendTo('#mrs-patient-list');
  }).always(function() {

    // Get fake patients
    $.get("https://www.openice.info/files/fhir-patients.json", function( d ) {
      console.log('getting fake patients');
      for(var i = 0; i < d.entry.length; i++) {
        patientData[d.entry[i].resource.id] = d.entry[i].resource;
        patientData[d.entry[i].resource.id].age = moment().diff(d.entry[i].resource.birthDate, 'years');
        patientData[d.entry[i].resource.id].genderShort = 'M';
      }
      
      // GET observation resource data for proper patients
      GetPatientObservations();
      // construct after second stage of GETs for patient info
      ConstructPatientList();
      // these are coupled so the stupid UI works - specifically removing noData calss
    });
  });
}

function ConstructPatientList () {
  console.log('constructing patient list');

  document.getElementById('mrs-patient-list').innerHTML = null;

  for (var i = 0; i < Object.keys(patientData).length; i++) {
    (function () {
      var pt = patientData[Object.keys(patientData)[i]];

      var ptContainer = jQuery('<table/>', {
        id: pt.id,
        'class': 'mrs-ptContainer noData'
      });

      var topRow = jQuery('<tr/>').appendTo(ptContainer);
      var bottomRow = jQuery('<tr/>').appendTo(ptContainer);

      jQuery('<td/>', { 'class': 'mrs-pt-familyName' }).html(pt.name[0].family[0] || null).appendTo(bottomRow);
      jQuery('<td/>', { 'class': 'mrs-pt-givenName' }).html(pt.name[0].given[0] || null).appendTo(topRow);
      jQuery('<td/>', { 'class': 'mrs-pt-age' }).html(pt.age || null).appendTo(topRow);
      jQuery('<td/>', { 'class': 'mrs-pt-gender' }).html(pt.genderShort || null).appendTo(topRow);
      jQuery('<td/>', { 'class': 'mrs-pt-identifier' }).html(pt.identifier[0].value || null)
          .attr('colspan', '2').appendTo(bottomRow);

      ptContainer.click(function() { ChangeActivePatient(pt.id, false) }).appendTo('#mrs-patient-list')
    })()
  }

  // Set patient-list height to itself plus 100px to allow scrolling past the bottom patient on list
  $('#mrs-patient-list').height($('#mrs-patient-list').height() + 100);
}

function GetPatientObservations () {
  console.log('GETting observations for fhir patients');

  function CleanObservationData (data, pt) {
    for (var j = 0; j < data.entry.length; j++) {
      var metric = data.entry[j].resource.valueQuantity ? data.entry[j].resource.valueQuantity.code : null;   // get metric
      var t = +UTCtoEpoch(data.entry[j].resource.appliesDateTime);   // get time of measurement
      var y = data.entry[j].resource.valueQuantity ? data.entry[j].resource.valueQuantity.value : null;   // get vital sign measurement
      var device = data.entry[j].resource.device ? data.entry[j].resource.device.reference : null;   // get source device

      device = device ? device.slice(7) : null;

      if (metric && t && y && device) {
        if (!observationData[pt]) {
          observationData[pt] = {}
        }

        if (!observationData[pt][device + '-' + metric]) {
          observationData[pt][device + '-' + metric] = []
        }

        observationData[pt][device + '-' + metric].push({'x':t, 'y':y});
      }
    }

    if (observationData[pt]) {
      // Sort metric observations by time
      for (var k = 0; k < Object.keys(observationData[pt]).length; k++) {
        observationData[pt][Object.keys(observationData[pt])[k]].sort(function (a, b) {
          return a.x - b.x;
        });
      }

      ConstructPatientDashboard(pt);

    }
  }

  // get fhir observations
  for (var i = 0; i < Object.keys(patientData).length; i++) {
    (function () {
      var pt = Object.keys(patientData)[i];

      if(pt !== '987654321') {   // ignore the fake patient id... yes this is ugly
        $.get('https://fhir.openice.info/fhir/Observation?subject=Patient/'+pt+'&_count=10000&_sort:desc=date', function( data ) {
          if (data.total) {
            console.log('Data found for pt:', pt, data);

            CleanObservationData(data, pt);

            patientData[pt].hasData = true;
            $( '#'+pt ).removeClass('noData');

          } else {
            console.log('No observations found for patient ID', pt, data);
            
            patientData[pt].hasData = false;
            $( '#'+pt ).addClass('noData');
            
            var dashboard = jQuery('<li/>', {
              id: 'dashboard-' + pt,
              'class': 'mrs-dashboard'
            }).hide().appendTo('#mrs-demo-dashboardHolder');
            
            jQuery('<div/>', {
              'class': 'dashboard-no-data'
            }).html('No FHIR Observation resource data found for this patient.').appendTo(dashboard);

          }
        });
      }
    })()
  }

  // get fake observations
  $.get('https://www.openice.info/files/fhir-data.json', function (data) {
    CleanObservationData(data, '987654321');
    patientData['987654321'].hasData = true;
    $( '#987654321' ).removeClass('noData');
  });
}

function ConstructPatientDashboard (pt) {
  var data = observationData[pt];

  console.log('creating dashboard for pt', pt);

  // Delete old dashboard on refresh
  $( '#dashboard-' + pt ).remove();

  var dashboard = jQuery('<li/>', {
    id: 'dashboard-' + pt,
    'class': 'mrs-dashboard'
  }).hide().appendTo('#mrs-demo-dashboardHolder');

  var chartContainer = jQuery('<div/>', {
    id: 'chartContainer-' + pt,
    'class': 'chartContainer'
  }).appendTo(dashboard);

  var yAxis = jQuery('<div/>', {
    id: 'yAxis-' + pt,
    'class': 'yAxis'
  }).appendTo(chartContainer);

  var chart = jQuery('<div/>', {
    id: 'chart-' + pt,
    'class': 'chart'
  }).appendTo(chartContainer);

  var timelineDiv = jQuery('<div/>', {
    id: 'timeline-' + pt,
    'class': 'timeline'
  }).appendTo(chartContainer);
  
  var legendDiv = jQuery('<div/>', {
    id: 'legend-' + pt,
    'class': 'chartLegend'
  }).appendTo(chartContainer);

  // var sliderDiv = jQuery('<div/>', {
  //   id: 'slider-' + pt,
  //   'class': 'slider'
  // }).appendTo(chartContainer);

  var palette = new Rickshaw.Color.Palette( { scheme: 'munin' } );

  var graphData = [];
  var graphData2 = [];
  var metrics = Object.keys(data);

  // TODO scale y axis and clamp at 225 or something.
  for (var i = 0; i < metrics.length; i++) {
      //      if (metrics[i].indexOf('status') < 1) {
      graphData.push({
        name: metrics[i],
        data: data[metrics[i]],
        color: palette.color()
      });
      // var min = Number.POSITIVE_INFINITY;
      // var max = Number.NEGATIVE_INFINITY;
      // var tmp;
      // for (var j = 0; j < graphData[i].data.length; j++) {
      //   tmp = graphData[i].data[j].y;
      //   if (tmp < min) { min = tmp };
      //   if (tmp > max) { max = tmp };
      // };
      // graphData[i].ymax = max;
      //      };
  };

  var graph = new Rickshaw.Graph({
    element: chart[0],
    width: $( '.mrs-demo-container' ).innerWidth() - 70,
    height: 400,
    renderer: 'scatterplot',
    max: 200,
    series: graphData
  });

  var x_axis = new Rickshaw.Graph.Axis.Time({
    graph: graph,
    // timeUnit: {
    //   name: '1 hour',
    //   seconds: 3600 * 1,
    //   formatter: function(d) { return moment(d).format('LTS') }
    // }
  });

  var y_axis = new Rickshaw.Graph.Axis.Y({
    graph: graph,
    orientation: 'left',
    tickFormat: Rickshaw.Fixtures.Number.formatKMBT,
    element: yAxis[0]
  });

  var hoverDetail = new Rickshaw.Graph.HoverDetail({
    graph: graph,
    xFormatter: function (x) {
      return moment.unix(x).format('LTS');
    },
    formatter: function(series, x, y) {
      var swatch = '<span class="detail_swatch" style="background-color: ' + series.color + '"></span>';
      var yvalue = '<span class="date">' + series.name + ": " + parseInt(y) + '</span>';
      var date = '<span class="date">' + moment.unix(x).format('ll LTS') + '</span>';
      var content = swatch + yvalue + '<br>' + date;
      return content;
    }
  });

  var legend = new Rickshaw.Graph.Legend({
      graph: graph,
      element: legendDiv[0]
  });
  var shelving = new Rickshaw.Graph.Behavior.Series.Toggle({
      graph: graph,
      legend: legend
  });
  var highlighter = new Rickshaw.Graph.Behavior.Series.Highlight({
      graph: graph,
      legend: legend
  });

  var annotator = new Rickshaw.Graph.Annotate({
    graph: graph,
    element: document.getElementById('timeline-'+pt)
  });


  // if (assessments) {
  //   for (var i = 0; i < assessments.length; i++) {
  //     console.log(assessments[i].t, assessments[i].ass);
  //     annotator.add(assessments[i].t, assessments[i].ass);
  //     annotator.update();
  //   };
  // };

  // var slider = new Rickshaw.Graph.RangeSlider.Preview({
  //   graph: graph,
  //   element: sliderDiv[0]
  // });

  graph.render();

  if (pt === activePatient) { ChangeActivePatient(pt, true) };
}

function ChangeActivePatient (patientID, override) {
  activePatient = patientID;
  override = override === null ? false : override;   // I don't know why this is here but I'm afraid of deleting it

  var selectedPtContainer = document.getElementById(patientID);

  if ( !$( selectedPtContainer ).hasClass('activePt') || override ) {
    
    console.log('Switching dashboard view to patient', patientID);

    // change active class in patient menu
    $(document.getElementById("mrs-patient-list").getElementsByClassName('activePt')).removeClass('activePt');
    $(selectedPtContainer).addClass('activePt');

    // remove splash screen
    $( '#dashboard-splash' ).hide();

    // show demo header and dashboardHolder
    $( '#mrs-demo-header' ).show();
    $( '#mrs-demo-dashboardHolder' ).show();

    // switch dashboard patient header
    // $( '#header-picture' ).html( patientData[patientID].picture || null );
    $( '#header-familyName' ).html( patientData[patientID].name[0].family[0] || null);
    $( '#header-givenName' ).html( patientData[patientID].name[0].given[0] || null);
    $( '#header-birthDate' ).html( patientData[patientID].birthDate || null);
    $( '#header-age' ).html( patientData[patientID].age || null);
    $( '#header-gender' ).html( patientData[patientID].gender || null);
    $( '#header-mrn' ).html( patientData[patientID].identifier[0].value || null);

    // switch dashboard visibility
    $( '#mrs-demo-dashboardHolder' ).children().hide();
    $( '#dashboard-' + patientID ).show();
  
  } else {
    console.log('Patient selected is already active. PID', patientID);
  }
}

function ShowSplash () {
  console.log('showing home screen');
  // hide dashboards
  $( '#mrs-demo-dashboardHolder' ).children().hide();
  $( '#mrs-demo-dashboardHolder' ).hide();
  // hide demo header
  $( '#mrs-demo-header' ).hide();
  // show splash screen
  $( '#dashboard-splash' ).show();
  // remove active class from patient
  $(document.getElementById("mrs-patient-list").getElementsByClassName('activePt')).removeClass('activePt');
}

function UTCtoEpoch (t) {
  return moment(t, moment.ISO_8601).format('X');
}

// Attach button event listeners
$( window ).load(function() {
  $('#button-RefreshData').click(function () {
    if (!refreshTimeout) {
      console.log('refreshing page');
      patientData = {};
      observationData = {};
      activePatient = {};
      ShowSplash();
      PopulatePatientData();
      refreshTimeout = true;
      setTimeout(function() { refreshTimeout = false }, 3002);
    }
  });

  $('#button-ShowSplash').click(function () {
    ShowSplash();
  });

  $('#button-DeleteActivePatient').click(function () {
    var r = confirm("Are you sure you would like to DELETE this patient from the FHIR server?");

    if (r === true) {
      console.log('Deleting patient ', activePatient);
      $.ajax({
        url: 'https://fhir.openice.info/fhir/Patient/' + activePatient,
        type: 'DELETE'
      });

      delete patientData[activePatient];
      delete observationData[activePatient];

      // remove the daashboard of the activePatient
      $( '#dashboard-' + activePatient ).remove();
      activePatient = {};
      ShowSplash();
      ConstructPatientList();

      for (var i = 0; i < Object.keys(observationData).length; i++) {
        $( '#' + Object.keys(observationData)[i] ).removeClass( 'noData' );
      }
    }
  });
});
