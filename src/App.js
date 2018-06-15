//@flow
import React, { Component } from 'react';
import './App.css';

import noise_image from './noise.png';
import * as twgl from "twgl"
import video_source from "./vhsintros.mp4"

class GLRenderer extends React.Component {
  constructor(props) {
    super(props)
    this.gl = null
  }
  componentDidMount() {
    this.gl = this.gl || this.refs.canvas.getContext("webgl2")
    twgl.addExtensionsToContext(this.gl)
    
    requestAnimationFrame((time) => { this._Draw(this.gl, time) });

    this.Initialize(this.gl)

    window.addEventListener('resize', () => {
      this.Initialize(this.gl)
    })
  }
  
  render() {
    return <canvas ref="canvas"/>
  }

  _Draw (gl, time) {
    this.Draw(gl, time);
    requestAnimationFrame((time) => { this._Draw(gl, time) });
  }
}

class Simulation extends GLRenderer {
  constructor(props) {
    super(props)
    this.frame = 0
  }
  Initialize(gl) {
    this.refs.canvas.width = document.documentElement.clientWidth
    this.refs.canvas.height = document.documentElement.clientHeight

    this.rectangle = twgl.createBufferInfoFromArrays(gl, {
      position: [-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0],
    });
    
    // front and back buffers
    this.buffers = []
    for (let i = 0; i < 2; i++)
    {
      this.buffers[i] = twgl.createFramebufferInfo(
        gl,
        [{ 
          format: gl.RED, 
          internalFormat: gl.R16F,
          type: gl.FLOAT, 
          mag: gl.LINEAR, 
          min: gl.LINEAR,
          wrap: gl.REPEAT,
        },],  
        gl.canvas.width,
        gl.canvas.height
      )
    }

    const vertex_program = `
      attribute vec4 position;
      void main() {
        gl_Position = position;
      }
    `

    const program_header = `
      precision highp float;
      #define texture texture2D
      
      uniform float iTime;
      uniform vec2 iResolution;
      uniform sampler2D noise_tex;
      uniform sampler2D video_tex;
      uniform sampler2D fft_tex;
      uniform vec3 iMouse;
    `

    this.simulationProgram = twgl.createProgramInfo(gl, [
      vertex_program,
      program_header + `
        uniform sampler2D iChannel0;
        uniform int iFrame;

      ` + this.props.simulation
    ])

    this.shadeProgram = twgl.createProgramInfo(gl, [
      vertex_program,
      program_header + `
        uniform sampler2D iChannel0;

      ` + this.props.shade
    ])

    this.noise_tex = twgl.createTexture(gl, {
      src: noise_image,
    })

    this.fft_texture = twgl.createTexture(gl, {
      min: gl.LINEAR,
      wrap: gl.REPEAT,
    })
    
    this.video_texture = twgl.createTexture(gl, {
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.REPEAT,
    })

    this.uniforms = {}
    
    this.SetupMouse(gl)

    if (!this.audioContext)
    {
      let context = new AudioContext()
      
      let analyser = context.createAnalyser()
      //analyser.minDecibels = -90;
      //analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 1.0;
      analyser.fftSize =2048

      var bufferLength = analyser.frequencyBinCount
      this.fftArray = new Uint8Array(bufferLength)
      
      this.audioAnalyser = analyser
      this.audioContext = context
    }

    if (!this.video) 
    {
      let video = document.createElement("video")

      document.body.appendChild(video)

      let source = this.audioContext.createMediaElementSource(video);

      source.connect(this.audioAnalyser)
      this.audioAnalyser.connect(this.audioContext.destination)
    

      var playing = false;
      var timeupdate = false;
    
      video.autoplay = true;
      video.muted = false;
      video.loop = true;
     
      let self = this;
      function checkReady() {
        video.setAttribute("controls", "controls")
        video.height = document.documentElement.clientHeight
        video.width = document.documentElement.clientWidth

        if (playing && timeupdate) {
          self.copyVideo = true;
        }
      }
    
      video.addEventListener('playing', function() {
          playing = true;
          checkReady();
      }, true);
    
      video.addEventListener('timeupdate', function() {
          timeupdate = true;
          checkReady();
      }, true);
    
      video.src = video_source;
      video.play();
      video.volume = 1;
            
      this.video = video;
    }
  }

  UpdateTexture() {
    if (!this.copyVideo) return;

    const gl = this.gl
    const level = 0;
    const internalFormat = gl.RGBA;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    gl.bindTexture(gl.TEXTURE_2D, this.video_texture);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, srcFormat, srcType, this.video);
  }

  UpdateFFT() {
    this.audioAnalyser.getByteTimeDomainData(this.fftArray)
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.fft_texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.fftArray.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, this.fftArray);
  }

  SetupMouse(gl) {
    this.mouse_pos = {x: 0, y: 0, z: 0}

    function getRelativeMousePosition(event, target) {
      target = target || event.target;
      var rect = target.getBoundingClientRect();
    
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
    }
    
    // assumes target or event.target is canvas
    function getNoPaddingNoBorderCanvasRelativeMousePosition(event, target) {
      target = target || event.target;
      var pos = getRelativeMousePosition(event, target);
    
      pos.x = pos.x * target.width  / target.clientWidth;
      pos.y = pos.y * target.height / target.clientHeight;
    
      return pos;  
    }

    let self = this
    function mouse_event(evt)
    {
      self.mouse_pos = getNoPaddingNoBorderCanvasRelativeMousePosition(evt)
      self.mouse_pos.z = evt.buttons;
    }

    function touch_event(evt)
    {
      evt = evt.touches.item(0)

      self.mouse_pos = getNoPaddingNoBorderCanvasRelativeMousePosition(evt)
      self.mouse_pos.z = 1;
    }

    function stop_event(evt)
    {
      self.mouse_pos.z = 0;
    }

    gl.canvas.addEventListener("mousemove", mouse_event, false);
    gl.canvas.addEventListener("mousedown", mouse_event, false);

    gl.canvas.addEventListener("touchmove", touch_event, false);
    gl.canvas.addEventListener("ontouchstart", touch_event, false);

    gl.canvas.addEventListener("mouseup", stop_event, false);
    gl.canvas.addEventListener("touchend", stop_event, false);
    gl.canvas.addEventListener("touchcancel", stop_event, false);
  }

  PreDraw() {}

  Draw(gl, time) {
    this.PreDraw(gl, time)

    if (twgl.resizeCanvasToDisplaySize(gl.canvas)) {
      for (let i = 0; i < 2; i++)
      {
        twgl.resizeFramebufferInfo(gl, this.buffers[i]);
      }
    }

    this.UpdateTexture()
    this.UpdateFFT()

    let u = this.uniforms

    u.iResolution = [gl.canvas.width, gl.canvas.height]
    
    u.iFrame = this.frame
    u.iMouse = [
      this.mouse_pos.x, 
      -this.mouse_pos.y + gl.canvas.height, 
      this.mouse_pos.z
    ]
    u.iTime = time * 0.0015
    u.noise_tex = this.noise_tex
    u.video_tex = this.video_texture
    u.fft_tex = this.fft_texture

    u.iChannel0 = this.buffers[1].attachments[0]

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[0].framebuffer);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.useProgram(this.simulationProgram.program);
      twgl.setBuffersAndAttributes(gl, this.simulationProgram, this.rectangle);
      twgl.setUniforms(this.simulationProgram, this.uniforms);
      twgl.drawBufferInfo(gl, this.rectangle);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    [this.buffers[0], this.buffers[1]] = [this.buffers[1], this.buffers[0]] 

    this.frame = this.frame + 1


    u.iChannel0 = this.buffers[1].attachments[0]
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);   

    gl.useProgram(this.shadeProgram.program);
    twgl.setBuffersAndAttributes(gl, this.shadeProgram, this.rectangle);
    twgl.setUniforms(this.shadeProgram, this.uniforms);
    twgl.drawBufferInfo(gl, this.rectangle);
  }
}

class App extends Component {
  render() {
    return (
      <div className="App">       
       <Simulation 
          simulation={`
            #define FFT(f) texture(fft_tex, vec2(f, 0.0)).x
            #define PIXEL(x, y) texture(iChannel0, uv + vec2(x, y) / iResolution.xy).r

            void mainImage(out vec4 out_color, in vec2 coordinates)
            {    
                vec2 uv = coordinates.xy / iResolution.xy;
                
                float v = PIXEL(0.0, 0.0);
                v = PIXEL(
                    sin(PIXEL(v, 0.0)  - PIXEL(-v, 0.0) + 3.1415) * v * 0.4, 
                    cos(PIXEL(0.0, -v) - PIXEL(0.0 , v) - 1.57) * v * 0.4
                );
                v += pow(FFT(pow(v*0.1, 1.5) * 0.25) * 1.5, 3.0);
                v -= pow(length(texture(video_tex, uv * vec2(1.0, -1.0))) + 0.05, 3.0) * 0.08;
                v *= 0.925 + FFT(v)*0.1;
                
                out_color.r = v;
            }

            void main() { mainImage(gl_FragColor, gl_FragCoord.xy); }
          `}
          shade={`
            void mainImage( out vec4 out_color, in vec2 coordinates )
            {
                vec2 uv = coordinates.xy/iResolution.xy;
                float v = texture(iChannel0, uv).r * 1.5;
                    
                vec3 color = pow(vec3(cos(v), tan(v), sin(v)) * 0.5 + 0.5, vec3(0.5));
                vec3 e = vec3(vec2(1.0) / iResolution.xy, 0.0);
                vec3 grad = normalize(vec3(
                    texture(iChannel0, uv + e.xz).x - texture(iChannel0, uv - e.xz).x, 
                    texture(iChannel0, uv + e.zy).x - texture(iChannel0, uv - e.zy).x, 1.0));
                vec3 light = vec3(0.26, -0.32, 0.91);
                float diffuse = dot(grad, light);
                float spec = pow(max(0.0, -reflect(light, grad).z), 32.0);
                
                out_color.rgb = (color * diffuse) + spec;
                out_color.a = 1.0;
            }

            void main() { mainImage(gl_FragColor, gl_FragCoord.xy); }
          `}
        />
      </div>
    );
  }
}

export default App;