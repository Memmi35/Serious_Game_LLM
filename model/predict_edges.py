import sys
import json
import joblib
import os
import warnings

# Suppress scikit-learn warnings about version mismatches if any
warnings.filterwarnings("ignore", category=UserWarning)

def main():
    try:
        # Load the model using joblib
        model_path = os.path.join(os.path.dirname(__file__), 'edge_travel_time_rf.pkl')
        model_dict = joblib.load(model_path)
        model = model_dict['model']

        # Read JSON from stdin
        input_data = sys.stdin.read()
        if not input_data.strip():
            print(json.dumps({"error": "No input provided"}))
            return
            
        req = json.loads(input_data)
        edges = req.get('edges', [])
        
        if not edges:
            print(json.dumps({"predictions": []}))
            return

        # Prepare features array based on:
        # ["free_time", "capacity", "base_flow", "flow", "congestion_ratio"]
        features = []
        for e in edges:
            features.append([
                float(e.get('free_time', 0)),
                float(e.get('capacity', 0)),
                float(e.get('base_flow', 0)),
                float(e.get('flow', 0)),
                float(e.get('congestion_ratio', 0))
            ])
        
        # Predict
        preds = model.predict(features)
        
        # Return results
        print(json.dumps({"predictions": preds.tolist()}))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
