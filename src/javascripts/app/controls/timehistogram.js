define(['events/events', 'utils', 'draggable'], function(Events, Utils, Draggable) {

  /** Constants **/
  var  BAR_STROKE = '#3182bd',

       BAR_FILL = '#6baed6',

       MIN_UPDATE_DELAY = 800;

  var TimeHistogram = function(parent, facetField, eventBroker) {

    var container = jQuery(
          '<div id="time-histogram">' +
          '  <canvas width="320" height="40"></canvas>' +
          '  <span class="axislabel from"></span>' +
          '  <span class="axislabel zero">1 AD</span>' +
          '  <span class="axislabel to"></span>' +

          '  <div class="selection"></div>' +

          '  <div class="handle from">' +
          '    <div class="label"></div>' +
          '  </div>' +

          '  <div class="handle to">' +
          '    <div class="label"></div>' +
          '  </div>' +
          '</div>'),

        /** Canvas element **/
        canvas = container.find('canvas'),

        canvasWidth, canvasOffset,

        /** Drawing context - initialize after appending canvas to DOM **/
        ctx,

        /** Selected interval bounds indicator **/
        selectionBounds = container.find('.selection'),

        /** Interval handle elements **/
        fromHandle = container.find('.handle.from'),
        fromHandleLabel = fromHandle.find('.label'),

        toHandle = container.find('.handle.to'),
        toHandleLabel = toHandle.find('.label'),

        /** It's safe to assume that both handles are identical **/
        handleWidth,

        /** Labels for earliest/latest year of histogram **/
        histogramFromLabel = container.find('.axislabel.from'),
        histogramZeroLabel = container.find('.axislabel.zero'),
        histogramToLabel = container.find('.axislabel.to'),

        /** Caches the current histogram range  **/
        histogramRange = false,

        /** Ignore subsequent updates **/
        ignoreUpdates = false,

        /** Caches the selection range **/
        selectionRange = false,

        /** Conversion function: x offset to year **/
        xToYear = function(x) {
          var duration = histogramRange.to.getFullYear() - histogramRange.from.getFullYear() + 1,
              yearsPerPixel = duration / canvasWidth;

          return Math.round(histogramRange.from.getFullYear() + x * yearsPerPixel);
        },

        /** Conversion function: year to x offset **/
        yearToX = function(year) {
          var duration = histogramRange.to.getFullYear() - histogramRange.from.getFullYear() + 1,
              pixelsPerYear = canvasWidth / duration;

          return Math.round((year - histogramRange.from.getFullYear()) * pixelsPerYear);
        },

        /** Returns the currently selected time range **/
        getSelectedRange = function() {
          if (!selectionRange && histogramRange) {
            var xFrom = Math.max(0, selectionBounds.position().left) - canvasOffset,
                yearFrom = xToYear(xFrom),

                xTo = Math.min(xFrom + selectionBounds.outerWidth(), canvasWidth),
                yearTo = xToYear(xTo) - 1;

            if (yearFrom > yearTo)
              yearTo = yearFrom;

            if (yearFrom > histogramRange.from.getFullYear() || yearTo < histogramRange.to.getFullYear())
              selectionRange = { from: yearFrom, to: yearTo };
          }

          return selectionRange;
        },

        onDragHandle = function(e) {
          var maxX, minX,
              posX = jQuery(e.target).position().left;

          // Clear cached range
          selectionRange = false;

          if (e.target === fromHandle[0]) {
            // Left handle
            minX = handleWidth + 1;
            maxX = toHandle.position().left - handleWidth;

            if (posX < minX) {
              fromHandle.css('left', minX);
              return false;
            } else if (posX > maxX) {
              fromHandle.css('left', maxX);
              return false;
            }

            // Update handle label
            fromHandleLabel.show();
            fromHandleLabel.html(Utils.formatYear(xToYear(posX + handleWidth - canvasOffset)));

            // Update selection bounds
            selectionBounds.css('left', posX + handleWidth);
            selectionBounds.css('width', maxX - posX - 1);
          } else {
            // Right handle constraint check
            minX = fromHandle.position().left + handleWidth + 1;
            maxX = canvasOffset + canvasWidth + 2;

            if (posX < minX) {
              toHandle.css('left', minX + 1);
              return false;
            } else if (posX > maxX) {
              toHandle.css('left', maxX);
              return false;
            }

            // Update handle label
            toHandleLabel.show();
            toHandleLabel.html(Utils.formatYear(xToYear(posX - canvasOffset)));

            // Update selection bounds
            selectionBounds.css('width', posX - minX);
          }
        },

        onStopHandle = function(e) {
          onDragHandle(e);

          var selection = getSelectedRange();
          fromHandleLabel.empty();
          fromHandleLabel.hide();
          toHandleLabel.empty();
          toHandleLabel.hide();

          if (selection)
            eventBroker.fireEvent(Events.SEARCH_CHANGED, selection);
          else
            // Remove time filter altogether
            eventBroker.fireEvent(Events.SEARCH_CHANGED, { from: false, to: false });
        },

        onDragBounds = function(e) {
          var offsetX = selectionBounds.position().left - canvasOffset,
              width = selectionBounds.outerWidth(),

              fromYear = xToYear(offsetX),
              toYear = xToYear(offsetX + width);

          // Clear cached range
          selectionRange = false;

          fromHandleLabel.html(Utils.formatYear(fromYear));
          fromHandleLabel.show();
          fromHandle.css('left', offsetX - handleWidth + canvasOffset);

          toHandleLabel.html(Utils.formatYear(toYear));
          toHandleLabel.show();
          toHandle.css('left', offsetX + width + canvasOffset);

          eventBroker.fireEvent(Events.SEARCH_CHANGED, getSelectedRange());
        },

        onStopBounds = function(e) {
          onDragBounds(e);

          fromHandleLabel.empty();
          fromHandleLabel.hide();

          toHandleLabel.empty();
          toHandleLabel.hide();
        },

        setSelection = function(from, to) {
          selectionRange = { from: from, to: to };

          selectionNewFromX = Math.max(0, yearToX(from));
          selectionNewToX = Math.min(yearToX(to + 1), canvasWidth);

          if (selectionNewFromX > selectionNewToX)
            selectionNewFromX = selectionNewToX;

          selectionBounds.css('left', selectionNewFromX + canvasOffset);
          fromHandle.css('left', selectionNewFromX + canvasOffset - handleWidth);

          selectionBounds.css('width', selectionNewToX - selectionNewFromX);
          toHandle.css('left', selectionNewToX + canvasOffset);
        },

        update = function(response) {
          if (!ignoreUpdates) {
            // SOLR interleaves keys and values into one array
            var values = Utils.chunkArray(response.facet_counts.facet_ranges[facetField].counts, 2);
            if (values && values.length > 0) {
              var currentSelection = getSelectedRange(),
                  selectionNewFromX, selectionNewToX, // Updated selection bounds
                  maxValue = Math.max.apply(Math, jQuery.map(values, function(val) { return val[1]; })),
                  minYear = new Date(values[0][0]),
                  maxYear = new Date(values[values.length - 1][0]),
                  height = ctx.canvas.height - 1,
                  xOffset = 4,
                  drawingAreaWidth = ctx.canvas.width - 2 * xOffset,
                  barSpacing = Math.round(drawingAreaWidth / values.length),
                  barWidth = barSpacing - 4;

              histogramRange = { from: minYear, to: maxYear };

              // Relabel
              histogramFromLabel.html(Utils.formatYear(minYear));
              histogramToLabel.html(Utils.formatYear(maxYear));

              if (minYear.getFullYear() < 0 && maxYear.getFullYear() > 0) {
                histogramZeroLabel.show();
                histogramZeroLabel[0].style.left = (yearToX(0) + canvasOffset - 35) + 'px';
              } else {
                histogramZeroLabel.hide();
              }

              // Redraw
              ctx.clearRect(0, 0, canvasWidth, ctx.canvas.height);

              // 1 AD marker
              jQuery.each(values, function(idx, value) {
                var barHeight = Math.round(Math.sqrt(value[1] / maxValue) * height);
                ctx.strokeStyle = BAR_STROKE;
                ctx.fillStyle = BAR_FILL;
                ctx.beginPath();
                ctx.rect(xOffset + 0.5, height - barHeight + 0.5, barWidth, barHeight);
                ctx.fill();
                ctx.stroke();
                xOffset += barSpacing;
              });

              // Reset labels & selection
              histogramRange.from = minYear;
              histogramRange.to = maxYear;

              setSelection(currentSelection.from, currentSelection.to);

              // We don't want to handle to many updates - introduce a wait
              ignoreUpdates = true;
              setTimeout(function() { ignoreUpdates = false; }, MIN_UPDATE_DELAY);
            }
          }
        };

    fromHandleLabel.hide();
    toHandleLabel.hide();
    parent.append(container);

    ctx = canvas[0].getContext('2d');
    canvasWidth = canvas.outerWidth(false);
    canvasOffset = (canvas.outerWidth(true) - canvasWidth) / 2;
    handleWidth = fromHandle.outerWidth();

    Draggable.makeXDraggable(fromHandle, onDragHandle, onStopHandle);
    Draggable.makeXDraggable(toHandle, onDragHandle, onStopHandle);
    Draggable.makeXDraggable(selectionBounds, onDragBounds, onStopBounds, canvas);

    eventBroker.addHandler(Events.SOLR_TIME_HISTOGRAM, update);
  };

  return TimeHistogram;

});
