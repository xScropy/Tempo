//! LAN hosting: a deliberately dumb WebSocket hub.
//!
//! It accepts connections and shuttles text frames between them and the
//! webview. All social logic (accounts, friends, presence, challenges) runs in
//! the TypeScript `SocialServer`, the same code the standalone server uses —
//! this file only moves bytes.

use futures_util::{SinkExt, StreamExt};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tokio::{net::TcpListener, sync::mpsc};
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};

const MAX_CONNECTIONS: usize = 64;
const MAX_MESSAGE_BYTES: usize = 1 << 20;

pub enum HubEvent {
    Open(u64),
    Message(u64, String),
    Close(u64),
}

type Conns = Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<Message>>>>;

pub struct Hub {
    conns: Conns,
    task: tokio::task::JoinHandle<()>,
    pub port: u16,
}

impl Hub {
    /// Binds on all interfaces so other devices on the network can reach it.
    pub async fn start<F>(port: u16, on_event: F) -> std::io::Result<Hub>
    where
        F: Fn(HubEvent) + Send + Sync + 'static,
    {
        let listener = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
        let port = listener.local_addr()?.port();
        let conns: Conns = Arc::default();
        let on_event = Arc::new(on_event);
        let next = Arc::new(AtomicU64::new(1));
        let accept_conns = conns.clone();

        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                if accept_conns.lock().map(|c| c.len()).unwrap_or(MAX_CONNECTIONS) >= MAX_CONNECTIONS {
                    continue; // dropping the stream refuses the connection
                }
                let id = next.fetch_add(1, Ordering::Relaxed);
                let conns = accept_conns.clone();
                let on_event = on_event.clone();
                tokio::spawn(async move {
                    let mut config = WebSocketConfig::default();
                    config.max_message_size = Some(MAX_MESSAGE_BYTES);
                    config.max_frame_size = Some(MAX_MESSAGE_BYTES);
                    let Ok(ws) = tokio_tungstenite::accept_async_with_config(stream, Some(config)).await else {
                        return;
                    };
                    let (mut sink, mut source) = ws.split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
                    if let Ok(mut map) = conns.lock() {
                        map.insert(id, tx);
                    }
                    on_event(HubEvent::Open(id));
                    let writer = tokio::spawn(async move {
                        while let Some(msg) = rx.recv().await {
                            let closing = matches!(msg, Message::Close(_));
                            if sink.send(msg).await.is_err() || closing {
                                break;
                            }
                        }
                    });
                    while let Some(Ok(msg)) = source.next().await {
                        match msg {
                            Message::Text(text) => on_event(HubEvent::Message(id, text.to_string())),
                            Message::Close(_) => break,
                            _ => {}
                        }
                    }
                    if let Ok(mut map) = conns.lock() {
                        map.remove(&id);
                    }
                    writer.abort();
                    on_event(HubEvent::Close(id));
                });
            }
        });
        Ok(Hub { conns, task, port })
    }

    pub fn send(&self, conn: u64, text: String) {
        if let Ok(map) = self.conns.lock() {
            if let Some(tx) = map.get(&conn) {
                let _ = tx.send(Message::Text(text.into()));
            }
        }
    }

    pub fn stop(self) {
        self.task.abort();
        if let Ok(mut map) = self.conns.lock() {
            for (_, tx) in map.drain() {
                let _ = tx.send(Message::Close(None));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    #[tokio::test]
    async fn relays_frames_between_clients_and_reports_lifecycle() {
        let (ev_tx, mut ev_rx) = mpsc::unbounded_channel::<(String, u64, String)>();
        let hub = Hub::start(0, move |e| {
            let _ = match e {
                HubEvent::Open(id) => ev_tx.send(("open".into(), id, String::new())),
                HubEvent::Message(id, t) => ev_tx.send(("message".into(), id, t)),
                HubEvent::Close(id) => ev_tx.send(("close".into(), id, String::new())),
            };
        })
        .await
        .unwrap();
        let url = format!("ws://127.0.0.1:{}", hub.port);

        let (mut a, _) = connect_async(&url).await.unwrap();
        let (kind, a_id, _) = ev_rx.recv().await.unwrap();
        assert_eq!(kind, "open");
        let (mut b, _) = connect_async(&url).await.unwrap();
        let (_, b_id, _) = ev_rx.recv().await.unwrap();
        assert_ne!(a_id, b_id);

        a.send(Message::Text("hello".into())).await.unwrap();
        assert_eq!(ev_rx.recv().await.unwrap(), ("message".to_string(), a_id, "hello".to_string()));

        // the "server logic" answers only the other client
        hub.send(b_id, "to-b".into());
        assert_eq!(b.next().await.unwrap().unwrap(), Message::Text("to-b".into()));

        a.close(None).await.unwrap();
        assert_eq!(ev_rx.recv().await.unwrap(), ("close".to_string(), a_id, String::new()));
        hub.stop();
    }
}
