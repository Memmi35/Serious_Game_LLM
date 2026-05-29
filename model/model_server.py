import sys
import json
import pandas as pd
import joblib
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler

model_data = joblib.load('model/edge_travel_time_rf.pkl')
model = model_data['model']
features = model_data['features']
print("Model loaded, server ready", flush=True)

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers['Content-Length'])
        body = json.loads(self.rfile.read(length))
        edges = body['edges']
        X = pd.DataFrame([[e[f] for f in features] for e in edges], columns=features)
        preds = model.predict(X).tolist()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'predictions': preds}).encode())

    def log_message(self, *args):
        pass  # silence request logs

HTTPServer(('127.0.0.1', 5001), Handler).serve_forever()
