from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np
import base64
from deepface import DeepFace
import logging
import traceback
import json

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

emotion_colors = {
    'angry': '#ff4757',
    'disgust': '#2ed573',
    'fear': '#a55eea',
    'happy': '#fbc531',
    'sad': '#3498db',
    'surprise': '#ff9f43',
    'neutral': '#dfe6e9'
}

# Custom JSON encoder to handle numpy types
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, tuple):
            return list(obj)
        return super(NumpyEncoder, self).default(obj)

app.json_encoder = NumpyEncoder

def convert_to_serializable(value):
    """Convert a value to a JSON-serializable format"""
    if hasattr(value, 'item'):
        return value.item()
    elif isinstance(value, (np.integer, np.int32, np.int64)):
        return int(value)
    elif isinstance(value, (np.floating, np.float32, np.float64)):
        return float(value)
    elif isinstance(value, (list, tuple)):
        return [convert_to_serializable(item) for item in value]
    elif isinstance(value, dict):
        return {key: convert_to_serializable(val) for key, val in value.items()}
    elif value is None:
        return None
    else:
        return value

@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/api/detect_emotion', methods=['POST'])
def detect_emotion():
    try:
        # Get image data from request
        data = request.get_json()
        logger.debug(f"Received request: {bool(data)}")
        
        if not data or 'image' not in data:
            logger.error("No image data provided")
            return jsonify({'error': 'No image data provided'}), 400
        
        image_data = data['image']
        if 'base64,' in image_data:
            image_data = image_data.split(',')[1]  
        
        logger.debug(f"Image data length: {len(image_data)}")
        
        nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            logger.error("Could not decode image")
            return jsonify({'error': 'Could not decode image'}), 400
        
        logger.debug(f"Image shape: {img.shape}")
        
        cv2.imwrite('debug_image.jpg', img)
        logger.debug("Saved debug image")
        
        try:
            analysis = DeepFace.analyze(
                img_path=img,
                actions=['emotion'],
                detector_backend='opencv',
                enforce_detection=False,
                silent=True
            )
            
            logger.debug(f"DeepFace analysis type: {type(analysis)}")
            logger.debug(f"DeepFace analysis: {analysis}")
            
            if isinstance(analysis, list) and len(analysis) > 0:
                result = analysis[0]
                dominant_emotion = result['dominant_emotion']
                
                emotions = {}
                for emotion, value in result['emotion'].items():
                    emotions[emotion] = convert_to_serializable(value)
                
                confidence = convert_to_serializable(emotions[dominant_emotion])
                
                face_region = {}
                if 'region' in result:
                    region_data = result['region']
                    for key, value in region_data.items():
                        face_region[key] = convert_to_serializable(value)
                
                logger.info(f"Detected emotion: {dominant_emotion} ({confidence:.1f}%)")
                
                return jsonify({
                    'emotion': dominant_emotion,
                    'confidence': confidence,
                    'emotions': emotions,
                    'face_region': face_region,
                    'color': emotion_colors.get(dominant_emotion.lower(), '#dfe6e9')
                })
            else:
                logger.info("No face detected")
                return jsonify({
                    'emotion': 'no_face',
                    'confidence': 0,
                    'emotions': {},
                    'face_region': {},
                    'color': '#dfe6e9'
                })
                
        except Exception as deepface_error:
            logger.error(f"DeepFace error: {str(deepface_error)}")
            logger.error(traceback.format_exc())
            return jsonify({
                'emotion': 'error',
                'confidence': 0,
                'emotions': {},
                'face_region': {},
                'color': '#dfe6e9',
                'error': str(deepface_error)
            })
            
    except Exception as e:
        logger.error(f"Error in emotion detection: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'emotion': 'error',
            'confidence': 0,
            'emotions': {},
            'face_region': {},
            'color': '#dfe6e9',
            'error': str(e)
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Server is running'})

@app.route('/api/test', methods=['GET'])
def test_endpoint():
    try:
        # Test with a simple image to see if DeepFace works
        import tempfile
        import os
        
        # Create a simple test image (a face-like pattern)
        test_img = np.zeros((200, 200, 3), dtype=np.uint8)
        
        # Draw a simple face
        cv2.rectangle(test_img, (50, 50), (150, 150), (255, 255, 255), -1)  # Face
        cv2.circle(test_img, (80, 80), 10, (0, 0, 0), -1)  # Left eye
        cv2.circle(test_img, (120, 80), 10, (0, 0, 0), -1)  # Right eye
        cv2.line(test_img, (90, 120), (110, 120), (0, 0, 0), 3)  # Mouth
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            cv2.imwrite(tmp.name, test_img)
            
            # Try to analyze
            analysis = DeepFace.analyze(
                img_path=tmp.name,
                actions=['emotion'],
                detector_backend='opencv',
                enforce_detection=False,
                silent=True
            )
            
            # Clean up
            os.unlink(tmp.name)
            
            # Convert numpy values to native Python types
            if isinstance(analysis, list) and len(analysis) > 0:
                result = analysis[0]
                emotions = {}
                for emotion, value in result['emotion'].items():
                    emotions[emotion] = convert_to_serializable(value)
                
                return jsonify({
                    'status': 'success',
                    'emotion': result['dominant_emotion'],
                    'emotions': emotions
                })
            else:
                return jsonify({
                    'status': 'success',
                    'message': 'No face detected in test image'
                })
            
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)