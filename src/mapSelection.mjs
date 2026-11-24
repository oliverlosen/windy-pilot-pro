// Capture the gesture on the map surface before Windy's weather picker handles it.
// Map panning and controls keep their normal pointer events.
export function selectMapPoints(map, onPoint, onError, isVisible=()=>true) {
    const container = map.getContainer();
    const controls = 'button,a,input,select,textarea,[role="button"],[role="dialog"],.leaflet-control,.maplibregl-control-container,.plugin__content';
    let gesture = null;
    const maxMove = 6;
    const overControl = event => Boolean(event.target?.closest?.(controls));
    function down(event) {
        if (!isVisible() || !event.isPrimary || event.button !== 0 || overControl(event) ||
            event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
            gesture = null;
            return;
        }
        gesture = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false};
    }
    function move(event) {
        if (gesture?.id === event.pointerId &&
            Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y) > maxMove)
            gesture.moved = true;
    }
    function cancel() { gesture = null; }
    function click(event) {
        const start = gesture;
        gesture = null;
        if (!start || start.moved || event.button !== 0 || overControl(event) ||
            Math.hypot(event.clientX-start.x,event.clientY-start.y) > maxMove) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        try {
            let c;
            if (typeof map.mouseEventToLatLng === 'function') c = map.mouseEventToLatLng(event);
            else {
                const bounds = container.getBoundingClientRect();
                c = map.containerPointToLatLng([event.clientX-bounds.left-container.clientLeft,
                    event.clientY-bounds.top-container.clientTop]);
            }
            const lng = c?.lng ?? c?.lon;
            if (!Number.isFinite(c?.lat) || Math.abs(c.lat)>90 || !Number.isFinite(lng))
                throw new Error('Coordenadas inválidas');
            const lon = ((lng+180)%360+360)%360-180;
            onPoint({lat:Number(c.lat.toFixed(5)),lon:Number(lon.toFixed(5))});
        } catch {
            onError('No se pudo convertir el clic a coordenadas. Puedes usar el centro del mapa.');
        }
    }
    const events = {pointerdown:down,pointermove:move,pointercancel:cancel,click};
    const previousCursor = container.style.cursor;
    container.style.cursor = 'crosshair';
    for (const [type,handler] of Object.entries(events))
        container.addEventListener(type,handler,true);
    return () => {
        for (const [type,handler] of Object.entries(events))
            container.removeEventListener(type,handler,true);
        container.style.cursor = previousCursor;
        cancel();
    };
}
