//@flow
import React, { Component } from 'react';
import './App.css';

import noise_image from './noise.png';
import * as twgl from "twgl"

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
  }
  
  render() {
    return <canvas ref="canvas" width={this.props.width} height={this.props.height}/>
  }

  _Draw (gl, time) {
    // fps limit here
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
      
      uniform float time;
      uniform vec2 resolution;
      uniform sampler2D noise_tex;
    `

    this.simulationProgram = twgl.createProgramInfo(gl, [
      vertex_program,
      program_header + `
        uniform sampler2D self;
        uniform int frame;
        uniform vec3 mouse;

      ` + this.props.simulation
    ])

    this.shadeProgram = twgl.createProgramInfo(gl, [
      vertex_program,
      program_header + `
        uniform sampler2D self;

      ` + this.props.shade
    ])

    this.noise_tex = twgl.createTexture(gl, {
      src: noise_image,
    })


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
  Draw(gl, time) {
    if (twgl.resizeCanvasToDisplaySize(gl.canvas)) {
      for (let i = 0; i < 2; i++)
      {
        twgl.resizeFramebufferInfo(gl, this.buffers[i]);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[0].framebuffer);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

      const uniforms = {
        resolution: [gl.canvas.width, gl.canvas.height],
        self: this.buffers[1].attachments[0],
        frame: this.frame,
        mouse: [
          this.mouse_pos.x, 
          -this.mouse_pos.y + gl.canvas.height, 
          this.mouse_pos.z
        ],
        time: time * 0.0015,
        noise_tex: this.noise_tex,
      };

      gl.useProgram(this.simulationProgram.program);
      twgl.setBuffersAndAttributes(gl, this.simulationProgram, this.rectangle);
      twgl.setUniforms(this.simulationProgram, uniforms);
      twgl.drawBufferInfo(gl, this.rectangle);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    [this.buffers[0], this.buffers[1]] = [this.buffers[1], this.buffers[0]] 

    this.frame = this.frame + 1

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);   

    gl.useProgram(this.shadeProgram.program);
    twgl.setBuffersAndAttributes(gl, this.shadeProgram, this.rectangle);
    twgl.setUniforms(this.shadeProgram, {
      self: this.buffers[1].attachments[0],
      resolution: [gl.canvas.width, gl.canvas.height],
      time: time,
      noise_tex: this.noise_tex,
    });
    twgl.drawBufferInfo(gl, this.rectangle);
  }
}

class App extends Component {
  render() {
    return (
      <div className="App"> 
       <Simulation 
          width={document.documentElement.clientWidth} 
          height={document.documentElement.clientHeight} 
          simulation={`
            const float pi = 3.14159265358979323846264338327950288419716939937510582097494459230781640;
            const float pi2 = pi/2.0;

            float random()
            {
              return fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);  
            }

            vec4 get_pixel(float x_offset, float y_offset)
            {
              vec2 gravity = vec2(0.0, 0.001);
              return texture(self, gravity + (gl_FragCoord.xy / resolution.xy) + (vec2(x_offset, y_offset) / resolution.xy));
            }

            float step_simulation()
            {
              float val = get_pixel(0.0, 0.0).r;
                
                val += random()*val*0.15; // errosion
                
                val = get_pixel(
                  sin(get_pixel(val, 0.0).r  - get_pixel(-val, 0.0) + pi).r  * val * 0.4, 
                    cos(get_pixel(0.0, -val).r - get_pixel(0.0 , val) - pi2).r * val * 0.4
                ).r;

                if (mouse.z > 0.0) 
                  val += smoothstep(length(resolution.xy)/10.0, 0.5, length(mouse.xy - gl_FragCoord.xy));
                
                val *= 1.001;
                
                return val;
            }

            void main()
            {    
                float val = step_simulation();
            
                if(frame == 0)
                    val = 
                      random()*length(resolution.xy)/100.0 + 
                      smoothstep(length(resolution.xy)/2.0, 0.5, length(resolution.xy * 0.5 - gl_FragCoord.xy))*25.0;
                            
                gl_FragColor.r = val;
            }
          `}
          shade={`
            void main() {
              vec2 uv = gl_FragCoord.xy / resolution;

              float val = texture2D(self, uv).r;
              
              vec4 color = pow(vec4(cos(val), tan(val), sin(val), 1.0) * 0.5 + 0.5, vec4(0.5));
        
              vec3 e = vec3(vec2(1.0)/resolution.xy,0.0);
              float p10 = texture(self, uv-e.zy).x;
              float p01 = texture(self, uv-e.xz).x;
              float p21 = texture(self, uv+e.xz).x;
              float p12 = texture(self, uv+e.zy).x;
                  
              vec3 grad = normalize(vec3(p21 - p01, p12 - p10, 1.));
              vec3 light = normalize(vec3(.2,-.25,.7));
              float diffuse = dot(grad,light);
              float spec = pow(max(0.,-reflect(light,grad).z),32.0);
              
              gl_FragColor = (color * diffuse) + spec;
              
              gl_FragColor.a = 1.0; 
            }          
          `}
        />
        <Simulation 
          width={document.documentElement.clientWidth} 
          height={document.documentElement.clientHeight} 
          simulation={`
            const float TEMPERATURE = 2.0;
            const float RADIUS = 1.33;

            const float PI = 3.14159265358979323846264338327950288419716939937510582097494459230781640;

            float random()
            {
              return fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);  
            }

            float get_average(vec2 uv, float size)
            {
                const float points = 14.0;
                const float Start = 2.0 / points;
                vec2 scale = (RADIUS * 5.0 / resolution.xy) + size;

                float res = texture(self, uv).r;

                for (float point = 0.0; point < points; point++)
                {
                    float r = (PI * 2.0 * (1.0 / points)) * (point + Start);
                    res += texture(self, uv + vec2(sin(r), cos(r)) * scale).r;
                }

                res /= points;

                return res;
            }

            void main()
            {
                vec2 uv = gl_FragCoord.xy/resolution.xy;
                
                vec3 noise = texture(noise_tex, time*0.001 + uv*0.015*0.25).rgb;
                float height = (noise.b*2.0-1.0) * 0.25;
                
                {	
                    vec2 muv = noise.xy;
                    
                    vec2 p = uv - muv;
                    float r = length(p);
                    float a = atan(p.y, p.x);
                    r = pow(r*2.0, 1.0 + height * 0.05);
                    p = r * vec2(cos(a)*0.5, sin(a)*0.5);

                    uv = p + muv;
                }
                                    
                //uv.y += 0.00025;

                if (frame == 0)
                {
                    gl_FragColor.r = random();
                    return;
                }
                
                float val = texture(self, uv).r;
                float avg = get_average(uv, height*-0.005);
                gl_FragColor.r = sin(avg * (2.3 + TEMPERATURE + height*2.0)) + sin(val);
              
                if (mouse.z > 0.0) 
                    gl_FragColor.r += smoothstep(length(resolution.xy)/5.0, 0.5, length(mouse.xy - gl_FragCoord.xy)) * sin(time*10.0);
            }  
          `}
          shade={`
            void main() {
              float v = texture(self, gl_FragCoord.xy/resolution.xy).r;
              v *= 0.5;
              v = v * 0.5 + 0.5;
              v = clamp(v, 0.0, 1.0);
              
              gl_FragColor.r = v*1.25;
              gl_FragColor.g = sin(v*0.1)*5.0+v;
              gl_FragColor.b = pow(v*5.0, 0.5)*0.26;
              gl_FragColor.a = 1.0;
            }          
          `}
        />
      </div>
    );
  }
}

export default App;