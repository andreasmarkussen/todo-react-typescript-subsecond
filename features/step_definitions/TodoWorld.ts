import webdriver from 'selenium-webdriver'
import IActor from '../../src/IActor'
import ReactActor from '../../src/ReactActor'
import TodoListActor from '../../src/TodoListActor'
import { After, defineParameterType, setWorldConstructor } from 'cucumber'
import TodoList from '../../src/TodoList'
import makeUseHttpTodoList from '../../src/hooks/makeUseHttpTodoList'
import makeHttpAddTodo from '../../src/hooks/makeHttpAddTodo'
import makeExpressApp from '../../src/server/makeExpressApp'
import WebDriverActor from '../../src/WebDriverActor'
import Server from '../../src/server/Server'
import makeWebpackMiddleware from '../../src/server/makeWebpackMiddleware'
import { promisify } from 'util'
import makeStaticMiddleware from '../../src/server/makeStaticMiddleware'

defineParameterType({
  name: 'actor',
  regexp: /[A-Z][a-z]+/,
  transformer(actorName: string): IActor {
    // this is an instance of TodoWorld
    return this.getActorByName(actorName)
  },
})

class TodoWorld {
  private readonly actorsByName = new Map<string, IActor>()
  private readonly closers: Array<() => Promise<void>> = []

  async getActorByName(name: string): Promise<IActor> {
    let actor = this.actorsByName.get(name)
    if (actor === undefined) {
      if (process.env.ASSEMBLY === 'react') {
        actor = this.makeReactActor()
      } else if (process.env.ASSEMBLY === 'react-http') {
        actor = await this.makeReactHttpActor()
      } else if (process.env.ASSEMBLY === 'webdriver') {
        actor = await this.makeWebDriverActor()
      } else {
        actor = new TodoListActor()
      }
      this.actorsByName.set(name, actor)
    }
    return actor
  }

  async close() {
    await Promise.all(this.closers.map(close => close()))
  }

  private makeReactActor(): IActor {
    const todoList = new TodoList()
    const useTodoList: UseTodoList = () => todoList.getTodos()
    const useAddTodo: AddTodo = async (todo: string) => todoList.add(todo)
    return new ReactActor(useTodoList, useAddTodo)
  }

  private async makeReactHttpActor(): Promise<IActor> {
    const app = makeExpressApp()
    const server = new Server(app)
    await server.listen(0)
    this.closers.push(server.close.bind(server))
    const baseURL = new URL(`http://localhost:${server.port}`)
    const useTodoList = makeUseHttpTodoList(baseURL)
    const addTodo = makeHttpAddTodo(baseURL)
    return new ReactActor(useTodoList, addTodo)
  }

  private async makeWebDriverActor(): Promise<IActor> {
    const webpackMiddleware = makeWebpackMiddleware()
    this.closers.push(promisify(webpackMiddleware.close.bind(webpackMiddleware)))
    const app = makeExpressApp(webpackMiddleware, makeStaticMiddleware())
    const server = new Server(app)
    await server.listen(0)
    this.closers.push(server.close.bind(server))
    const browser = new webdriver.Builder().forBrowser('firefox').build()
    await browser.get(`http://localhost:${server.port}`)
    this.closers.push(browser.close.bind(browser))
    return new WebDriverActor(browser)
  }
}

setWorldConstructor(TodoWorld)

After(function() {
  this.close()
})
