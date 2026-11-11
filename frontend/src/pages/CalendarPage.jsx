import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import itLocale from "@fullcalendar/core/locales/it";
import { api, CALENDAR_CHANGED } from "../lib/api.js";
import EventModal from "../components/EventModal.jsx";

const toFc = (e) => ({
  id: String(e.id),
  title: e.title,
  start: e.start,
  end: e.end || undefined,
  allDay: e.allDay,
  backgroundColor: e.color || undefined,
  borderColor: e.color || undefined,
  extendedProps: { description: e.description, location: e.location, color: e.color },
});

const fromFc = (ev) => ({
  title: ev.title,
  start: ev.allDay ? ev.startStr.slice(0, 10) : ev.start.toISOString(),
  end: ev.end ? (ev.allDay ? ev.endStr.slice(0, 10) : ev.end.toISOString()) : null,
  allDay: ev.allDay,
});

export default function CalendarPage() {
  const calRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState("");
  const isNarrow = window.matchMedia("(max-width: 700px)").matches;

  const fetchEvents = useCallback((info, success, failure) => {
    api
      .events(info.startStr, info.endStr)
      .then((list) => success(list.map(toFc)))
      .catch(failure);
  }, []);

  const refetch = useCallback(() => calRef.current?.getApi().refetchEvents(), []);

  useEffect(() => {
    window.addEventListener(CALENDAR_CHANGED, refetch);
    return () => window.removeEventListener(CALENDAR_CHANGED, refetch);
  }, [refetch]);

  const persistMove = async ({ event, revert }) => {
    try {
      await api.updateEvent(event.id, fromFc(event));
    } catch (e) {
      setErr(e.message);
      revert();
    }
  };

  const save = async (data) => {
    if (data.id) await api.updateEvent(data.id, data);
    else await api.createEvent(data);
    setModal(null);
    refetch();
  };

  const remove = async (id) => {
    await api.deleteEvent(id);
    setModal(null);
    refetch();
  };

  return (
    <div className="calendar-page card">
      <div className="calendar-head">
        <h2>Calendario</h2>
        <button className="btn primary" onClick={() => setModal({ allDay: false, start: null })}>
          + Nuovo impegno
        </button>
      </div>
      {err && <p className="error-text">{err}</p>}
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        locale={itLocale}
        initialView={isNarrow ? "listWeek" : "dayGridMonth"}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: isNarrow ? "listWeek,timeGridDay" : "dayGridMonth,timeGridWeek,listWeek",
        }}
        height="auto"
        nowIndicator
        selectable
        selectMirror
        editable
        dayMaxEvents={3}
        slotMinTime="06:00:00"
        events={fetchEvents}
        select={(info) => {
          setModal({ allDay: info.allDay, start: info.start, end: info.end });
          info.view.calendar.unselect();
        }}
        eventClick={(info) => {
          const ev = info.event;
          setModal({
            id: ev.id,
            title: ev.title,
            allDay: ev.allDay,
            start: ev.start,
            end: ev.end,
            ...ev.extendedProps,
          });
        }}
        eventDrop={persistMove}
        eventResize={persistMove}
      />
      {modal && <EventModal initial={modal} onClose={() => setModal(null)} onSave={save} onDelete={remove} />}
    </div>
  );
}
